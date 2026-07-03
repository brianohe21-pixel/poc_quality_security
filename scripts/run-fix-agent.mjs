import { execSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { Agent, CursorAgentError } from '@cursor/sdk';
import { requiredEnv } from './lib/linear-client.mjs';

function setGithubOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }
  const sanitized = String(value ?? '').replaceAll('\n', '%0A');
  appendFileSync(outputFile, `${name}=${sanitized}\n`);
}

function extractPrNumber(prUrl) {
  const match = prUrl.match(/\/pull\/(\d+)/);
  return match ? match[1] : '';
}

function sanitizeBranchPart(value) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');
}

function run(command) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  }).trim();
}

function formatFindingSummary(findings) {
  return findings
    .slice(0, 20)
    .map(
      (finding, index) =>
        `${index + 1}. ${finding.component || 'unknown'}:${finding.line || '?'} - ${finding.message} (${finding.rule})`
    )
    .join('\n');
}

function buildPrompt({ source, issueIdentifier, issueUrl, findings, supplementaryFindings, baseRef, strict }) {
  const findingsJson = JSON.stringify(findings, null, 2);
  const findingSummary = formatFindingSummary(findings);
  const sourceLabel = source === 'sonarcloud' ? 'SonarCloud code quality' : 'Snyk security';
  const supplementaryJson =
    supplementaryFindings?.length > 0
      ? JSON.stringify(supplementaryFindings, null, 2)
      : null;

  const supplementarySection = supplementaryJson
    ? `

Additional SonarCloud findings (fix these too so the PR passes SonarCloud CI):
${supplementaryJson}`
    : '';

  const fixScope =
    supplementaryJson && source === 'snyk'
      ? '- Fix all Snyk and SonarCloud issues listed below.'
      : '- Fix all listed findings in the primary section.';

  const strictSection = strict
    ? `

IMPORTANT:
- You MUST edit files in the working tree using write/edit tools.
- Start with src/index.js and package.json.
- Do not respond without applying code changes.
- Fix at least these findings:
${findingSummary}`
    : '';

  return `You are fixing ${sourceLabel} findings for a Node.js Express project.

Linear issue: ${issueIdentifier}
Linear URL: ${issueUrl}

Primary findings (${sourceLabel}):
${findingsJson}${supplementarySection}

Summary of findings to fix:
${findingSummary}

Requirements:
${fixScope}
- Keep all existing tests passing (run npm test).
- Do not introduce unrelated changes.
- Base branch is ${baseRef}.
- Apply the code changes in the working tree. Do not create commits or pull requests.
- Do not modify files under .github/.${strictSection}

Repository context: poc-quality-security Node.js service in src/.`;
}

async function runCloudAgent({ apiKey, owner, repo, baseRef, prompt }) {
  return Agent.prompt(prompt, {
    apiKey,
    model: { id: 'composer-2.5' },
    cloud: {
      repos: [{ url: `https://github.com/${owner}/${repo}`, startingRef: baseRef }],
      autoCreatePR: true,
      skipReviewerRequest: true,
    },
  });
}

function shouldFallbackToLocal(error) {
  if (!(error instanceof CursorAgentError)) {
    return false;
  }
  return /branch/i.test(error.message) && /exist|verify|not found/i.test(error.message);
}

function prepareWorkingTree(baseRef) {
  run('git config user.name "github-actions[bot]"');
  run('git config user.email "github-actions[bot]@users.noreply.github.com"');
  run('git fetch origin');

  const sha = process.env.GITHUB_SHA?.trim();
  if (sha) {
    console.log(`Checking out failing commit ${sha}`);
    run(`git checkout --detach ${sha}`);
    return;
  }

  console.log(`Checking out origin/${baseRef}`);
  run(`git checkout -B ${baseRef} origin/${baseRef}`);
}

function hasWorkingTreeChanges() {
  return Boolean(run('git status --porcelain'));
}

async function runLocalAgentOnce({ apiKey, prompt }) {
  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: 'composer-2.5' },
    mode: 'agent',
    local: { cwd: process.cwd(), settingSources: [] },
  });

  if (result.status === 'error') {
    throw new Error(`Local agent run failed: ${result.id}`);
  }

  if (result.result) {
    console.log(`Agent summary: ${result.result.slice(0, 1000)}`);
  }

  return result;
}

function createPullRequest({ owner, repo, baseRef, branchName, issueIdentifier, source }) {
  const title = `[auto-fix] ${issueIdentifier} ${source} remediation`;
  const body = `Automated remediation for Linear issue ${issueIdentifier} (${source}).`;
  const prUrl = run(
    `gh pr create --repo "${owner}/${repo}" --base "${baseRef}" --head "${branchName}" --title "${title}" --body "${body}"`
  );
  return prUrl;
}

async function runLocalAgentAndCreatePr({
  apiKey,
  owner,
  repo,
  baseRef,
  prompt,
  issueIdentifier,
  source,
  findings,
  supplementaryFindings,
  issueUrl,
}) {
  const maxAttempts = Number(process.env.LOCAL_AGENT_ATTEMPTS || 2);
  let result;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    prepareWorkingTree(baseRef);

    const attemptPrompt =
      attempt === 1
        ? prompt
        : buildPrompt({
            source,
            issueIdentifier,
            issueUrl,
            findings,
            supplementaryFindings,
            baseRef,
            strict: true,
          });

    console.log(`Running local agent attempt ${attempt}/${maxAttempts}`);
    result = await runLocalAgentOnce({ apiKey, prompt: attemptPrompt });

    if (hasWorkingTreeChanges()) {
      break;
    }

    if (attempt === maxAttempts) {
      throw new Error('Local agent completed without file changes');
    }

    console.warn('Local agent made no file changes, retrying with stricter prompt');
  }

  const branchName = `fix/linear-${sanitizeBranchPart(issueIdentifier)}-${source}`;
  run('git checkout -- .github/');
  run(`git checkout -b "${branchName}"`);
  run('git add -A');
  run(`git commit -m "fix(${source}): auto-remediate ${issueIdentifier}"`);
  run(`git push origin "${branchName}" --force-with-lease`);

  const prUrl = createPullRequest({ owner, repo, baseRef, branchName, issueIdentifier, source });

  return {
    result,
    prUrl,
    branchName,
    prNumber: extractPrNumber(prUrl),
    usedBaseRef: baseRef,
    runtime: 'local',
  };
}

function extractCloudResult(result, usedBaseRef) {
  const branch = result.git?.branches?.[0];
  const prUrl = branch?.prUrl || '';
  const branchName = branch?.branch || '';
  return {
    result,
    prUrl,
    branchName,
    prNumber: extractPrNumber(prUrl),
    usedBaseRef,
    runtime: 'cloud',
  };
}

function loadFindingsContext(source, findingsPath) {
  const findings = JSON.parse(readFileSync(findingsPath, 'utf8'));
  const sonarFindingsPath = process.env.SONAR_FINDINGS_PATH?.trim();
  const supplementaryFindings =
    source === 'snyk' && sonarFindingsPath
      ? JSON.parse(readFileSync(sonarFindingsPath, 'utf8'))
      : null;

  return { findings, supplementaryFindings };
}

function writeAgentOutputs(outcome) {
  setGithubOutput('agent_run_id', outcome.result.id || '');
  setGithubOutput('pr_url', outcome.prUrl);
  setGithubOutput('pr_number', outcome.prNumber);
  setGithubOutput('branch_name', outcome.branchName);
  setGithubOutput('base_ref', outcome.usedBaseRef);
  setGithubOutput('agent_runtime', outcome.runtime);

  console.log(
    `Agent run ${outcome.result.id} completed via ${outcome.runtime} (base ref: ${outcome.usedBaseRef})`
  );
  if (outcome.prUrl) {
    console.log(`Pull request: ${outcome.prUrl}`);
  }
}

async function runCloudOrFallback(params) {
  const { runtimeMode, ...localParams } = params;

  try {
    const result = await runCloudAgent({
      apiKey: localParams.apiKey,
      owner: localParams.owner,
      repo: localParams.repo,
      baseRef: localParams.baseRef,
      prompt: localParams.prompt,
    });
    if (result.status === 'error') {
      throw new Error(`Cloud agent run failed: ${result.id}`);
    }
    const outcome = extractCloudResult(result, localParams.baseRef);
    if (!outcome.prUrl && !outcome.branchName) {
      throw new Error('Cloud agent completed without PR URL or branch name');
    }
    return outcome;
  } catch (error) {
    const canFallback = runtimeMode === 'auto' && shouldFallbackToLocal(error);
    if (!canFallback) {
      if (error instanceof CursorAgentError) {
        console.error(`Agent startup failed: ${error.message} (retryable=${error.isRetryable})`);
        process.exit(1);
      }
      throw error;
    }

    console.warn('Cloud agent cannot access the repository. Falling back to local agent in CI.');
    return runLocalAgentAndCreatePr(localParams);
  }
}

async function runFixAgent() {
  const apiKey = requiredEnv('CURSOR_API_KEY');
  const source = requiredEnv('SOURCE');
  const issueIdentifier = requiredEnv('LINEAR_ISSUE_IDENTIFIER');
  const issueUrl = process.env.LINEAR_ISSUE_URL || '';
  const findingsPath = requiredEnv('FINDINGS_PATH');
  const repository = requiredEnv('GITHUB_REPOSITORY');
  const baseRef = process.env.REMEDIATION_BASE_REF?.trim() || 'develop';
  const runtimeMode = (process.env.CURSOR_AGENT_RUNTIME || 'auto').toLowerCase();
  const [owner, repo] = repository.split('/');

  const { findings, supplementaryFindings } = loadFindingsContext(source, findingsPath);

  if (!findings.length) {
    throw new Error(`No findings found in ${findingsPath}`);
  }

  console.log(`Loaded ${findings.length} primary findings for remediation`);
  const prompt = buildPrompt({
    source,
    issueIdentifier,
    issueUrl,
    findings,
    supplementaryFindings,
    baseRef,
    strict: false,
  });

  const localParams = {
    apiKey,
    owner,
    repo,
    baseRef,
    prompt,
    issueIdentifier,
    source,
    findings,
    supplementaryFindings,
    issueUrl,
  };

  const outcome =
    runtimeMode === 'local'
      ? await runLocalAgentAndCreatePr(localParams)
      : await runCloudOrFallback({ ...localParams, runtimeMode });

  writeAgentOutputs(outcome);
}

try {
  await runFixAgent();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
