import { appendFileSync, writeFileSync } from 'node:fs';
import { requiredEnv } from './lib/linear-client.mjs';

const SNYK_API_URL = 'https://api.snyk.io';

function setGithubOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }
  const sanitized = String(value ?? '').replace(/\n/g, '%0A');
  appendFileSync(outputFile, `${name}=${sanitized}\n`);
}

async function snykRequest(path, token) {
  const response = await fetch(`${SNYK_API_URL}${path}`, {
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Snyk API HTTP ${response.status}: ${body}`);
  }

  return response.json();
}

async function resolveOrgId(token) {
  const configured = process.env.SNYK_ORG_ID?.trim();
  if (configured) {
    return configured;
  }

  const orgs = await snykRequest('/v1/orgs', token);
  if (!orgs?.length) {
    throw new Error('No Snyk organizations found for token');
  }
  return orgs[0].id;
}

async function resolveProjectId(orgId, token, repoName) {
  const projects = await snykRequest(`/v1/org/${orgId}/projects`, token);
  const match = (projects.projects || []).find((project) => {
    const name = (project.name || '').toLowerCase();
    const remote = (project.remoteRepoUrl || '').toLowerCase();
    return name.includes(repoName.toLowerCase()) || remote.includes(repoName.toLowerCase());
  });

  if (!match) {
    throw new Error(`Snyk project not found for repository "${repoName}"`);
  }

  return match.id;
}

async function fetchSnykFindings() {
  const token = requiredEnv('SNYK_TOKEN');
  const repoName = requiredEnv('GITHUB_REPOSITORY').split('/')[1];
  const outputPath = process.env.FINDINGS_OUTPUT || 'findings.json';
  const severities = new Set(['high', 'critical']);

  const orgId = await resolveOrgId(token);
  const projectId = await resolveProjectId(orgId, token, repoName);
  const payload = await snykRequest(
    `/v1/org/${orgId}/project/${projectId}/aggregated-issues`,
    token
  );

  const findings = (payload.issues || [])
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

  writeFileSync(outputPath, JSON.stringify(findings, null, 2));
  setGithubOutput('findings_path', outputPath);
  setGithubOutput('findings_count', String(findings.length));

  console.log(`Fetched ${findings.length} Snyk findings to ${outputPath}`);
}

fetchSnykFindings().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
