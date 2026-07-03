import { appendFileSync, readFileSync } from 'node:fs';
import { Agent, CursorAgentError } from '@cursor/sdk';
import { requiredEnv } from './lib/linear-client.mjs';

function setGithubOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }
  const sanitized = String(value ?? '').replace(/\n/g, '%0A');
  appendFileSync(outputFile, `${name}=${sanitized}\n`);
}

function extractPrNumber(prUrl) {
  const match = prUrl.match(/\/pull\/(\d+)/);
  return match ? match[1] : '';
}

function buildPrompt({ source, issueIdentifier, issueUrl, findings }) {
  const findingsJson = JSON.stringify(findings, null, 2);
  const sourceLabel = source === 'sonarcloud' ? 'SonarCloud code quality' : 'Snyk security';

  return `You are fixing ${sourceLabel} findings for a Node.js Express project.

Linear issue: ${issueIdentifier}
Linear URL: ${issueUrl}

Findings to fix:
${findingsJson}

Requirements:
- Fix only the issues listed above.
- Keep all existing tests passing (run npm test).
- Do not introduce unrelated changes.
- Base branch is develop.
- Open a pull request targeting develop when done.

Repository context: poc-quality-security Node.js service in src/.`;
}

async function runFixAgent() {
  const apiKey = requiredEnv('CURSOR_API_KEY');
  const source = requiredEnv('SOURCE');
  const issueIdentifier = requiredEnv('LINEAR_ISSUE_IDENTIFIER');
  const issueUrl = process.env.LINEAR_ISSUE_URL || '';
  const findingsPath = requiredEnv('FINDINGS_PATH');
  const repository = requiredEnv('GITHUB_REPOSITORY');
  const [owner, repo] = repository.split('/');

  const findings = JSON.parse(readFileSync(findingsPath, 'utf8'));
  const prompt = buildPrompt({ source, issueIdentifier, issueUrl, findings });

  let result;
  try {
    result = await Agent.prompt(prompt, {
      apiKey,
      model: { id: 'composer-2.5' },
      cloud: {
        repos: [{ url: `https://github.com/${owner}/${repo}`, startingRef: 'develop' }],
        autoCreatePR: true,
        skipReviewerRequest: true,
      },
    });
  } catch (error) {
    if (error instanceof CursorAgentError) {
      console.error(`Agent startup failed: ${error.message} (retryable=${error.isRetryable})`);
      process.exit(1);
    }
    throw error;
  }

  if (result.status === 'error') {
    console.error(`Agent run failed: ${result.id}`);
    setGithubOutput('agent_run_id', result.id || '');
    process.exit(2);
  }

  const branch = result.git?.branches?.[0];
  const prUrl = branch?.prUrl || '';
  const branchName = branch?.branch || '';
  const prNumber = extractPrNumber(prUrl);

  setGithubOutput('agent_run_id', result.id || '');
  setGithubOutput('pr_url', prUrl);
  setGithubOutput('pr_number', prNumber);
  setGithubOutput('branch_name', branchName);

  console.log(`Agent run ${result.id} completed`);
  if (prUrl) {
    console.log(`Pull request: ${prUrl}`);
  } else if (branchName) {
    console.log(`Branch pushed: ${branchName} (no PR URL returned)`);
  } else {
    throw new Error('Agent completed without PR URL or branch name');
  }
}

runFixAgent().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
