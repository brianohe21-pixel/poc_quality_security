import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { requiredEnv } from './lib/linear-client.mjs';

const SNYK_API_URL = 'https://api.snyk.io';
const SNYK_ID_PATTERN = /^[a-f0-9-]+$/i;

function setGithubOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }
  const sanitized = String(value ?? '').replaceAll('\n', '%0A');
  appendFileSync(outputFile, `${name}=${sanitized}\n`);
}

function assertSnykId(value, label) {
  if (!SNYK_ID_PATTERN.test(value)) {
    throw new Error(`Invalid Snyk ${label}`);
  }
}

function buildSnykApiUrl(path) {
  const url = new URL(path, SNYK_API_URL);
  if (url.origin !== SNYK_API_URL) {
    throw new Error('Invalid Snyk API URL');
  }
  return url;
}

function buildSafePath() {
  const candidates = [
    dirname(process.execPath),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/local/sbin',
    '/usr/sbin',
    '/sbin',
  ];
  return [...new Set(candidates.filter((dir) => existsSync(dir)))].join(':');
}

async function snykRequest(path, token) {
  const response = await fetch(buildSnykApiUrl(path), {
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Snyk API HTTP ${response.status}: ${body}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function resolveOrgId(token) {
  const configured = process.env.SNYK_ORG_ID?.trim();
  if (configured) {
    assertSnykId(configured, 'organization id');
    return configured;
  }

  const orgs = await snykRequest('/v1/orgs', token);
  if (!orgs?.length) {
    throw new Error('No Snyk organizations found for token');
  }
  return orgs[0].id;
}

async function resolveProjectId(orgId, token, repoName) {
  assertSnykId(orgId, 'organization id');
  const projects = await snykRequest(`/v1/org/${orgId}/projects`, token);
  const match = (projects.projects || []).find((project) => {
    const name = (project.name || '').toLowerCase();
    const remote = (project.remoteRepoUrl || '').toLowerCase();
    return name.includes(repoName.toLowerCase()) || remote.includes(repoName.toLowerCase());
  });

  if (!match) {
    throw new Error(`Snyk project not found for repository "${repoName}"`);
  }

  assertSnykId(match.id, 'project id');
  return match.id;
}

function fetchFindingsViaCli(outputPath) {
  let stdout = '';
  try {
    stdout = execSync('npx snyk test --json --severity-threshold=high', {
      encoding: 'utf8',
      env: { ...process.env, PATH: buildSafePath() },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const output = error.stdout?.toString() || '';
    if (output.trim().startsWith('{')) {
      stdout = output;
    } else {
      throw error;
    }
  }

  const payload = JSON.parse(stdout);
  const vulnerabilities = payload.vulnerabilities || [];

  return vulnerabilities.map((issue) => ({
    id: issue.id,
    title: issue.title,
    severity: issue.severity,
    packageName: issue.packageName,
    version: issue.version,
    identifiers: issue.identifiers,
    upgradePath: issue.upgradePath,
    from: issue.from,
    url: issue.url,
  }));
}

async function fetchFindingsViaApi(token, repoName) {
  const orgId = await resolveOrgId(token);
  const projectId = await resolveProjectId(orgId, token, repoName);
  const payload = await snykRequest(
    `/v1/org/${orgId}/project/${projectId}/aggregated-issues`,
    token
  );
  const severities = new Set(['high', 'critical']);

  return (payload.issues || [])
    .filter((entry) => severities.has((entry.issueData?.severity || '').toLowerCase()))
    .map((entry) => {
      const issue = entry.issueData || {};
      return {
        id: issue.id,
        title: issue.title,
        severity: issue.severity,
        packageName: issue.packageName,
        version: issue.version,
        identifiers: issue.identifiers,
        fixInfo: issue.fixInfo,
        upgradePath: issue.upgradePath,
        url: issue.url,
      };
    });
}

async function fetchSnykFindings() {
  const token = requiredEnv('SNYK_TOKEN');
  const repoName = requiredEnv('GITHUB_REPOSITORY').split('/')[1];
  const outputPath = process.env.FINDINGS_OUTPUT || 'findings.json';

  let findings;
  let source = 'api';

  try {
    findings = await fetchFindingsViaApi(token, repoName);
  } catch (error) {
    if (error.status === 403 || /not entitled for api access/i.test(error.message)) {
      console.warn('Snyk API not available on current plan. Falling back to snyk test CLI.');
      findings = fetchFindingsViaCli(outputPath);
      source = 'cli';
    } else {
      throw error;
    }
  }

  writeFileSync(outputPath, JSON.stringify(findings, null, 2));
  setGithubOutput('findings_path', outputPath);
  setGithubOutput('findings_count', String(findings.length));
  setGithubOutput('findings_source', source);

  console.log(`Fetched ${findings.length} Snyk findings via ${source} to ${outputPath}`);
}

try {
  await fetchSnykFindings();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
