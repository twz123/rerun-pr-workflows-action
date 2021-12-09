import type {RestEndpointMethodTypes} from '@octokit/plugin-rest-endpoint-methods';
import type {getOctokit} from '@actions/github';

export type GitHubClient = ReturnType<typeof getOctokit>;

export type IncomingPullRequest = {
  number: number;
  mergeable: string;
  headRef: {name: string};
  repository: {name: string; owner: {login: string}};
};

export type WorkflowRun =
  RestEndpointMethodTypes['actions']['listWorkflowRunsForRepo']['response']['data']['workflow_runs'][number];

export class Problem extends Error {
  cause?: unknown;
  opts: {[key: string]: unknown};

  constructor(message: string, opts: {[key: string]: unknown}) {
    super(message);
    this.opts = Object.assign({}, opts || {});
    if ('cause' in this.opts) {
      this.cause = this.opts.cause;
      delete this.opts.cause;
    }
  }
}
