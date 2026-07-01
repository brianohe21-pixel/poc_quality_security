# POC Quality Security

Proof of concept to integrate SonarCloud, Snyk and Linear through GitHub Actions. When SonarCloud quality gate or Snyk security scan fails, CI creates a summary issue in Linear.

## Stack

- Node.js 20 + Express dummy service
- SonarCloud for code quality
- Snyk for dependency vulnerabilities
- Linear for issue tracking
- GitHub Actions for CI orchestration

## Local development

```bash
npm install
npm test
npm start
```

The dummy service intentionally includes code smells, security hotspots and a vulnerable dependency (`lodash@4.17.15`) to demonstrate the CI failure flow.

## Manual setup

### 1. SonarCloud

1. Create an account at https://sonarcloud.io
2. Link your GitHub organization
3. Import the repository `poc_quality_security`
4. Confirm `sonar.projectKey` and `sonar.organization` in `sonar-project.properties`
5. Generate a token in SonarCloud
6. Add GitHub secret `SONAR_TOKEN`

### 2. Snyk

1. Create an account at https://snyk.io
2. Import the repository from the GitHub integration
3. Generate an API token
4. Add GitHub secret `SNYK_TOKEN`

### 3. Linear

1. Create a project in Linear (for example: Quality and Security POC)
2. Create optional labels: `sonarcloud`, `snyk`, `security`
3. Generate a Personal API Key in Settings → API
4. Get your Team ID (UUID) or team key:

```bash
curl -X POST https://api.linear.app/graphql \
  -H "Authorization: <LINEAR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ teams { nodes { id key name } } }"}'
```

Use the team `id` (UUID), team `key` (short code like `ENG`), or a project `name` (e.g. `Projects_BR`). The issue will be created in the project's team. Do not confuse project ID with team ID.

5. Add GitHub secret `LINEAR_API_KEY`
6. Add GitHub variable `LINEAR_TEAM_ID` with the team UUID or key

### 4. GitHub secrets and variables

| Name | Type | Description |
|------|------|-------------|
| `SONAR_TOKEN` | Secret | SonarCloud authentication token |
| `SNYK_TOKEN` | Secret | Snyk API token |
| `LINEAR_API_KEY` | Secret | Linear personal API key |
| `LINEAR_TEAM_ID` | Variable | Linear team UUID, team key, or project name |

## CI workflow

Workflow file: `.github/workflows/quality-security.yml`

| Job | Purpose |
|-----|---------|
| `build_and_test` | Install dependencies and run tests |
| `sonarcloud` | Run SonarCloud scan and quality gate |
| `snyk` | Run Snyk dependency scan |
| `linear-sonar-failure` | Create Linear issue when SonarCloud fails |
| `linear-snyk-failure` | Create Linear issue when Snyk fails |

## Expected behavior

1. Push code to `main` or open a pull request
2. GitHub Actions runs build, SonarCloud and Snyk
3. If SonarCloud quality gate fails, a summary issue is created in Linear with label `sonarcloud`
4. If Snyk finds high or critical vulnerabilities, a summary issue is created in Linear with label `snyk`
5. Each CI failure creates a new summary issue

## Validation checklist

- [ ] All secrets and variables configured in GitHub
- [ ] Repository imported in SonarCloud and Snyk
- [ ] Workflow visible in GitHub Actions tab
- [ ] At least one Linear issue created after a failed scan
- [ ] Issue description contains workflow run and dashboard links
