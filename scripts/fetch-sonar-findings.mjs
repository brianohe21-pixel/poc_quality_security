import { appendFileSync, writeFileSync } from 'node:fs';
import { requiredEnv } from './lib/linear-client.mjs';

const SONAR_API_URL = 'https://sonarcloud.io/api';

function setGithubOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }
  const sanitized = String(value ?? '').replaceAll('\n', '%0A');
  appendFileSync(outputFile, `${name}=${sanitized}\n`);
}

async function fetchSonarFindings() {
  const projectKey = requiredEnv('SONAR_PROJECT_KEY');
  const token = requiredEnv('SONAR_TOKEN');
  const outputPath = process.env.FINDINGS_OUTPUT || 'findings.json';

  const params = new URLSearchParams({
    componentKeys: projectKey,
    statuses: 'OPEN',
    ps: '50',
  });

  const response = await fetch(`${SONAR_API_URL}/issues/search?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SonarCloud API HTTP ${response.status}: ${body}`);
  }

  const payload = await response.json();
  const findings = (payload.issues || []).map((issue) => ({
    rule: issue.rule,
    severity: issue.severity,
    type: issue.type,
    component: issue.component,
    line: issue.line,
    message: issue.message,
    effort: issue.effort,
  }));

  writeFileSync(outputPath, JSON.stringify(findings, null, 2));
  setGithubOutput('findings_path', outputPath);
  setGithubOutput('findings_count', String(findings.length));

  console.log(`Fetched ${findings.length} open SonarCloud findings to ${outputPath}`);
}

try {
  await fetchSonarFindings();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
