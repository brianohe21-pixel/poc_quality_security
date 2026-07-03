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
      return `${error.stdout?.toString?.() || ''}${error.stderr?.toString?.() || ''}`.trim();
    }
    error.stdout = error.stdout?.toString?.() || '';
    error.stderr = error.stderr?.toString?.() || '';
    throw error;
  }
}

function getPrState(prNumber, repo) {
  const json = run(
    `gh pr view ${prNumber} --repo "${repo}" --json mergeable,mergeStateStatus,state`
  );
  return JSON.parse(json);
}

function hasChecksOutput(output) {
  return Boolean(output?.trim());
}

function parseCheckLine(line) {
  const match = line.match(/^(.+?)\t+(pass|fail|pending|skip|cancel)\t/i);
  if (match) {
    return { name: match[1].trim(), status: match[2].toLowerCase() };
  }
  const spaced = line.match(/^(.+?)\s+(pass|fail|pending|skip|cancel)(?:\s|$)/i);
  if (spaced) {
    return { name: spaced[1].trim(), status: spaced[2].toLowerCase() };
  }
  return null;
}

function shouldSkipCheck(checkName) {
  const remediationSource = process.env.REMEDIATION_SOURCE?.trim();
  if (remediationSource === 'sonarcloud' && /sonarcloud/i.test(checkName)) {
    return true;
  }
  const skipPattern = process.env.SKIP_CHECK_PATTERN?.trim();
  if (skipPattern && new RegExp(skipPattern, 'i').test(checkName)) {
    return true;
  }
  return false;
}

function checksFailed(output) {
  return output.split('\n').some((line) => {
    const check = parseCheckLine(line);
    if (!check) {
      return false;
    }
    if (shouldSkipCheck(check.name)) {
      console.log(`Skipping check "${check.name}" (${check.status}) for remediation source`);
      return false;
    }
    return check.status === 'fail';
  });
}

function checksPending(output) {
  return output.split('\n').some((line) => {
    const check = parseCheckLine(line);
    if (!check || shouldSkipCheck(check.name)) {
      return false;
    }
    return check.status === 'pending';
  });
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

function isMergeReady({ mergeable, mergeStateStatus, state }) {
  if (state === 'MERGED') {
    return 'merged';
  }
  const remediationSource = process.env.REMEDIATION_SOURCE?.trim();
  if (
    mergeable === 'MERGEABLE' &&
    (mergeStateStatus === 'CLEAN' || (remediationSource && mergeStateStatus === 'UNSTABLE'))
  ) {
    return 'ready';
  }
  if (mergeable === 'MERGEABLE' || mergeStateStatus === 'CLEAN') {
    return 'ready';
  }
  return 'blocked';
}

async function ensureMergeable(prNumber, repo, deadline) {
  const maxUpdates = Number(process.env.PR_UPDATE_ATTEMPTS || 3);
  let updates = 0;

  while (Date.now() < deadline) {
    const state = getPrState(prNumber, repo);
    const readiness = isMergeReady(state);

    if (readiness === 'merged') {
      console.log(`PR #${prNumber} already merged`);
      return;
    }

    if (readiness === 'ready') {
      return;
    }

    if (updates >= maxUpdates) {
      throw new Error(
        `PR #${prNumber} is not mergeable (${state.mergeStateStatus}) after ${maxUpdates} branch updates`
      );
    }

    console.log(`PR #${prNumber} not mergeable (${state.mergeStateStatus}), updating branch from base...`);
    run(
      `gh api --method PUT repos/${repo}/pulls/${prNumber}/update-branch -f update_method=rebase`
    );
    updates += 1;
    await waitForChecks(prNumber, repo, deadline);
  }

  throw new Error(`Timed out ensuring PR #${prNumber} is mergeable`);
}

async function waitForMerged(prNumber, repo, deadline) {
  const pollSeconds = Number(process.env.PR_POLL_SECONDS || 30);

  while (Date.now() < deadline) {
    const { state } = getPrState(prNumber, repo);
    if (state === 'MERGED') {
      return;
    }
    console.log(`Waiting for PR #${prNumber} to merge...`);
    await sleep(pollSeconds * 1000);
  }

  throw new Error(`Timed out waiting for PR #${prNumber} to merge`);
}

async function mergePullRequest(prNumber, repo, deadline) {
  const remediationSource = process.env.REMEDIATION_SOURCE?.trim();
  const strategies = [
    ['--merge'],
    ['--squash'],
    ['--rebase'],
    ['--auto', '--merge'],
  ];

  if (remediationSource) {
    strategies.unshift(['--admin', '--merge'], ['--admin', '--squash']);
  }

  for (const flags of strategies) {
    try {
      run(`gh pr merge ${prNumber} --repo "${repo}" ${flags.join(' ')}`);
      if (flags.includes('--auto')) {
        await waitForMerged(prNumber, repo, deadline);
      }
      console.log(`PR #${prNumber} merged`);
      return;
    } catch (error) {
      const message = `${error.stderr || ''}${error.stdout || ''}${error.message || ''}`.trim();
      console.warn(`Merge attempt (${flags.join(' ')}) failed: ${message}`);
    }
  }

  throw new Error(`Unable to merge PR #${prNumber}`);
}

async function waitAndMergePr() {
  const prNumber = requiredEnv('PR_NUMBER');
  const repo = requiredEnv('GITHUB_REPOSITORY');
  const maxWaitMinutes = Number(process.env.PR_WAIT_MINUTES || 30);
  const deadline = Date.now() + maxWaitMinutes * 60 * 1000;

  console.log(`Waiting for CI checks on PR #${prNumber} in ${repo}`);
  await waitForChecks(prNumber, repo, deadline);
  await ensureMergeable(prNumber, repo, deadline);
  await mergePullRequest(prNumber, repo, deadline);
}

try {
  await waitAndMergePr();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
