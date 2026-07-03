import { appendFileSync } from 'node:fs';

export const LINEAR_API_URL = 'https://api.linear.app/graphql';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function setGithubOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }
  const sanitized = String(value ?? '').replaceAll('\n', '%0A');
  appendFileSync(outputFile, `${name}=${sanitized}\n`);
}

export async function linearRequest(query, variables) {
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

export async function resolveTeamId(teamRef) {
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

export async function findLabelId(teamId, labelName) {
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
    console.warn('Could not resolve label');
    return null;
  }
}

export async function getIssueTeamId(issueId) {
  const data = await linearRequest(
    `query IssueTeam($issueId: String!) {
      issue(id: $issueId) {
        team {
          id
        }
      }
    }`,
    { issueId }
  );

  const teamId = data.issue?.team?.id;
  if (!teamId) {
    throw new Error(`Could not resolve team for issue ${issueId}`);
  }
  return teamId;
}

export async function resolveWorkflowStateId(teamId, stateName) {
  const overrideId = process.env[`LINEAR_STATE_${stateName.toUpperCase().replaceAll(/\s+/g, '_')}_ID`]?.trim();
  if (overrideId) {
    return overrideId;
  }

  const data = await linearRequest(
    `query TeamStates($teamId: String!) {
      team(id: $teamId) {
        states {
          nodes {
            id
            name
            type
          }
        }
      }
    }`,
    { teamId }
  );

  const states = data.team?.states?.nodes || [];
  const normalized = stateName.toLowerCase();
  const stateNameMap = {
    in_progress: 'In Progress',
    done: 'Done',
    failed: 'In Progress',
  };
  const lookupName = stateNameMap[normalized] || stateName;
  const normalizedLookup = lookupName.toLowerCase();

  const byName = states.find((state) => state.name.toLowerCase() === normalizedLookup);
  if (byName) {
    return byName.id;
  }

  const typeMap = {
    in_progress: 'started',
    done: 'completed',
    failed: 'started',
  };
  const targetType = typeMap[normalized];
  if (targetType) {
    const byType = states.find((state) => state.type === targetType);
    if (byType) {
      return byType.id;
    }
  }

  throw new Error(`Workflow state "${stateName}" not found for team ${teamId}`);
}

export async function createComment(issueId, body) {
  const data = await linearRequest(
    `mutation CommentCreate($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
      }
    }`,
    { input: { issueId, body } }
  );

  if (!data.commentCreate?.success) {
    throw new Error('Linear commentCreate returned success=false');
  }
}
