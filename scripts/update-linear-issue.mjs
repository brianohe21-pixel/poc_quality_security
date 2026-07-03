import {
  createComment,
  getIssueTeamId,
  linearRequest,
  requiredEnv,
  resolveWorkflowStateId,
} from './lib/linear-client.mjs';

async function updateIssue() {
  const issueId = requiredEnv('LINEAR_ISSUE_ID');
  const state = requiredEnv('STATE');
  const comment = process.env.COMMENT?.trim();

  const teamId = await getIssueTeamId(issueId);
  const stateId = await resolveWorkflowStateId(teamId, state);

  const data = await linearRequest(
    `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          identifier
          state {
            name
          }
        }
      }
    }`,
    { id: issueId, input: { stateId } }
  );

  if (!data.issueUpdate?.success) {
    throw new Error('Linear issueUpdate returned success=false');
  }

  console.log('Updated Linear issue state successfully');

  if (comment) {
    await createComment(issueId, comment);
    console.log('Added comment to Linear issue');
  }
}

try {
  await updateIssue();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
