import { execSync } from 'node:child_process';
import { requiredEnv } from './lib/linear-client.mjs';

function run(command, options = {}) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    env: process.env,
  })?.trim();
}

async function waitAndMergePr() {
  const prNumber = requiredEnv('PR_NUMBER');
  const repo = requiredEnv('GITHUB_REPOSITORY');

  console.log(`Waiting for CI checks on PR #${prNumber} in ${repo}`);

  try {
    run(`gh pr checks ${prNumber} --repo "${repo}" --watch`, { inherit: true });
  } catch (error) {
    console.error(`PR #${prNumber} checks failed or timed out`);
    process.exit(2);
  }

  run(`gh pr merge ${prNumber} --repo "${repo}" --merge`);
  console.log(`PR #${prNumber} merged into develop`);
}

waitAndMergePr().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
