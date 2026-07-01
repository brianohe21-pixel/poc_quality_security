const LINEAR_API_URL = 'https://api.linear.app/graphql';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function linearRequest(query, variables) {
  const response = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      Authorization: requiredEnv('LINEAR_API_KEY'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Linear API HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }

  if (payload.errors?.length) {
    throw new Error(`Linear API error: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data;
}

async function findLabelId(teamId, labelName) {
  const data = await linearRequest(
    `query TeamLabels($teamId: String!) {
      team(id: $teamId) {
        labels {
          nodes {
            id
            name
          }
        }
      }
    }`,
    { teamId }
  );

  const labels = data.team?.labels?.nodes || [];
  const match = labels.find((label) => label.name.toLowerCase() === labelName.toLowerCase());
  return match?.id || null;
}

async function createIssue() {
  const teamId = requiredEnv('LINEAR_TEAM_ID');
  const title = requiredEnv('TITLE');
  const description = requiredEnv('DESCRIPTION');
  const labelName = process.env.LABEL;

  const input = {
    teamId,
    title,
    description,
    priority: Number(process.env.PRIORITY || 2),
  };

  if (labelName) {
    const labelId = await findLabelId(teamId, labelName);
    if (labelId) {
      input.labelIds = [labelId];
    }
  }

  const data = await linearRequest(
    `mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          identifier
          url
        }
      }
    }`,
    { input }
  );

  const result = data.issueCreate;

  if (!result?.success) {
    throw new Error('Linear issueCreate returned success=false');
  }

  console.log(`Created Linear issue ${result.issue.identifier}: ${result.issue.url}`);
}

createIssue().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
