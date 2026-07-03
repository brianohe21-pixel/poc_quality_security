import { execSync } from 'node:child_process';
import { requiredEnv } from './lib/linear-client.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, options = {}) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: options.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })?.trim();
  } catch (error) {
    if (options.ignoreError) {
      return '';
    }
    error.stdout = error.stdout?.toString?.() || '';
    error.stderr = error.stderr?.toString?.() || '';
    throw error;
  }
}

function hasChecksOutput(output) {
  return Boolean(output?.trim());
}

function checksFailed(output) {
  return output.split('\n').some((line) => /\bfail/i.test(line));
}

function checksPending(output) {
  return output.split('\n').some((line) => /\spending\s/i.test(line) || /\sin progress\s/i.test(line));
}

async function waitForChecks(prNumber, repo, deadline) {
  const pollSeconds = Number(process.env.PR_POLL_SECONDS || 30);

  while (Date.now() < deadline) {
    const output = run(`gh pr checks ${prNumber} --repo "${repo}"`, { ignoreError: true });

    if (!hasChecksOutput(output)) {
      console.log('No checks reported yet, waiting...');
      await sleep(pollSeconds * 1000);
      continue;
    }

    if (checksPending(output)) {
      console.log('Checks still running...');
      await sleep(pollSeconds * 1000);
      continue;
    }

    if (checksFailed(output)) {
      console.error(`PR #${prNumber} checks failed:\n${output}`);
      process.exit(2);
    }

    console.log(`All checks passed for PR #${prNumber}`);
    return;
  }

  throw new Error(`Timed out waiting for PR #${prNumber} checks`);
}

async function waitAndMergePr() {
  const prNumber = requiredEnv('PR_NUMBER');
  const repo = requiredEnv('GITHUB_REPOSITORY');
  const maxWaitMinutes = Number(process.env.PR_WAIT_MINUTES || 30);
  const deadline = Date.now() + maxWaitMinutes * 60 * 1000;

  console.log(`Waiting for CI checks on PR #${prNumber} in ${repo}`);
  await waitForChecks(prNumber, repo, deadline);

  run(`gh pr merge ${prNumber} --repo "${repo}" --merge`);
  console.log(`PR #${prNumber} merged`);
}

try {
  await waitAndMergePr();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
