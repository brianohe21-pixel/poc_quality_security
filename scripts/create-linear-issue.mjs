const LINEAR_API_URL = 'https://api.linear.app/graphql';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
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

async function listTeams() {
  const data = await linearRequest(
    `query Teams {
      teams {
        nodes {
          id
          key
          name
        }
      }
    }`,
    {}
  );

  return data.teams?.nodes || [];
}

async function listProjects() {
  const data = await linearRequest(
    `query Projects {
      projects {
        nodes {
          id
          name
          teams {
            nodes {
              id
              key
              name
            }
          }
        }
      }
    }`,
    {}
  );

  return data.projects?.nodes || [];
}

async function resolveTeamId(teamRef) {
  const ref = teamRef.trim();
  const teams = await listTeams();

  if (UUID_PATTERN.test(ref)) {
    const match = teams.find((team) => team.id === ref);
    if (match) {
      return match.id;
    }
  } else {
    const teamMatch = teams.find(
      (team) =>
        team.key.toLowerCase() === ref.toLowerCase() ||
        team.name.toLowerCase() === ref.toLowerCase()
    );
    if (teamMatch) {
      return teamMatch.id;
    }

    const projects = await listProjects();
    const projectMatch = projects.find(
      (project) =>
        project.id === ref ||
        project.name.toLowerCase() === ref.toLowerCase()
    );
    if (projectMatch?.teams?.nodes?.length) {
      return projectMatch.teams.nodes[0].id;
    }
  }

  const teamOptions = teams.map((team) => `team ${team.key} → ${team.id}`).join(', ');
  const projectOptions = (await listProjects())
    .map((project) => `project ${project.name} → team ${project.teams?.nodes?.[0]?.key || 'unknown'}`)
    .join(', ');

  throw new Error(
    `Team or project "${ref}" not found in Linear. Set LINEAR_TEAM_ID to a team UUID, team key, or project name. Teams: ${teamOptions || 'none'}. Projects: ${projectOptions || 'none'}`
  );
}

async function findLabelId(teamId, labelName) {
  try {
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
  } catch (error) {
    console.warn(`Could not resolve label "${labelName}": ${error.message}`);
    return null;
  }
}

async function createIssue() {
  const teamId = await resolveTeamId(requiredEnv('LINEAR_TEAM_ID'));
  const title = requiredEnv('TITLE');
  const description = requiredEnv('DESCRIPTION');
  const labelName = process.env.LABEL?.trim();

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
