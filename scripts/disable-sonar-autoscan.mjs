import { requiredEnv } from './lib/linear-client.mjs';

async function disableSonarAutoscan() {
  const projectKey = requiredEnv('SONAR_PROJECT_KEY');
  const organization = requiredEnv('SONAR_ORGANIZATION');
  const token = requiredEnv('SONAR_TOKEN');

  const params = new URLSearchParams({
    project: projectKey,
    organization,
    enable: 'false',
  });

  const response = await fetch(`https://sonarcloud.io/api/autoscan/activation?${params}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    console.warn(`Could not disable SonarCloud automatic analysis (HTTP ${response.status}): ${body}`);
    return;
  }

  console.log('Disabled SonarCloud automatic analysis for CI-based analysis');
}

try {
  await disableSonarAutoscan();
} catch (error) {
  console.warn(error.message);
}
