import { appendFileSync } from 'node:fs';
import {
  findLabelId,
  linearRequest,
  requiredEnv,
  resolveTeamId,
} from './lib/linear-client.mjs';

function setGithubOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }
  const sanitized = String(value ?? '').replaceAll('\n', '%0A');
  appendFileSync(outputFile, `${name}=${sanitized}\n`);
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
          id
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

  const { id, identifier, url } = result.issue;

  setGithubOutput('issue_id', id);
  setGithubOutput('issue_identifier', identifier);
  setGithubOutput('issue_url', url);

  console.log('Created Linear issue successfully');
}

try {
  await createIssue();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
