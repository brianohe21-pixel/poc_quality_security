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
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function run(command) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  }).trim();
}

function buildPrompt({ source, issueIdentifier, issueUrl, findings, supplementaryFindings, baseRef }) {
  const findingsJson = JSON.stringify(findings, null, 2);
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
      : '- Fix only the issues listed above.';

  return `You are fixing ${sourceLabel} findings for a Node.js Express project.

Linear issue: ${issueIdentifier}
Linear URL: ${issueUrl}

Primary findings (${sourceLabel}):
${findingsJson}${supplementarySection}

Requirements:
${fixScope}
- Keep all existing tests passing (run npm test).
- Do not introduce unrelated changes.
- Base branch is ${baseRef}.
- Apply the code changes in the working tree. Do not create commits or pull requests.
- Do not modify files under .github/.

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

function prepareGitBase(baseRef) {
  run('git config user.name "github-actions[bot]"');
  run('git config user.email "github-actions[bot]@users.noreply.github.com"');
  run('git fetch origin');
  run(`git checkout -B ${baseRef} origin/${baseRef}`);
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
}) {
  prepareGitBase(baseRef);

  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: 'composer-2.5' },
    local: { cwd: process.cwd(), settingSources: [] },
  });

  if (result.status === 'error') {
    throw new Error(`Local agent run failed: ${result.id}`);
  }

  const status = run('git status --porcelain');
  if (!status) {
    throw new Error('Local agent completed without file changes');
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

function loadFindings(findingsPath, source, sonarFindingsPath) {
  const findings = JSON.parse(readFileSync(findingsPath, 'utf8'));
  const supplementaryFindings =
    source === 'snyk' && sonarFindingsPath
      ? JSON.parse(readFileSync(sonarFindingsPath, 'utf8'))
      : null;
  return { findings, supplementaryFindings };
}

async function runCloudWithFallback({ apiKey, owner, repo, baseRef, prompt, issueIdentifier, source, runtimeMode }) {
  try {
    const result = await runCloudAgent({ apiKey, owner, repo, baseRef, prompt });
    if (result.status === 'error') {
      throw new Error(`Cloud agent run failed: ${result.id}`);
    }
    const outcome = extractCloudResult(result, baseRef);
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
    return runLocalAgentAndCreatePr({
      apiKey,
      owner,
      repo,
      baseRef,
      prompt,
      issueIdentifier,
      source,
    });
  }
}

function reportOutcome(outcome) {
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

  const { findings, supplementaryFindings } = loadFindings(
    findingsPath,
    source,
    process.env.SONAR_FINDINGS_PATH?.trim()
  );
  const prompt = buildPrompt({
    source,
    issueIdentifier,
    issueUrl,
    findings,
    supplementaryFindings,
    baseRef,
  });

  const agentParams = { apiKey, owner, repo, baseRef, prompt, issueIdentifier, source };
  const outcome =
    runtimeMode === 'local'
      ? await runLocalAgentAndCreatePr(agentParams)
      : await runCloudWithFallback({ ...agentParams, runtimeMode });

  reportOutcome(outcome);
}

try {
  await runFixAgent();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
