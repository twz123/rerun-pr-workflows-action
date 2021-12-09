import * as core from '@actions/core';
import * as github from '@actions/github';
import {Action} from './action';
import {ActionsReporter} from './reporter';

process.on('unhandledRejection', handleError);

function handleError(err: unknown): void {
  console.error(err); // eslint-disable-line no-console
  core.setFailed(err instanceof Error ? err.message : String(err));
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function getActionParams() {
  return {
    githubToken: core.getInput('github-token', {required: true}),
    workflow: core.getInput('workflow', {required: true}),
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function getActionContext() {
  const params = getActionParams();
  return {
    eventName: github.context.eventName,
    payload: github.context.payload,
    client: github.getOctokit(params.githubToken),
    workflowName: params.workflow,
    reporter: new ActionsReporter(),
  };
}

Action.run(getActionContext()).catch(handleError);
