import * as core from '@actions/core';
import {GitHubClient, IncomingPullRequest, Problem, WorkflowRun} from './types';
import type {PushEvent} from '@octokit/webhooks-types';
import {Reporter} from './reporter';
import {WebhookPayload} from '@actions/github/lib/interfaces';

export class Action {
  private readonly client: GitHubClient;
  private readonly reporter: Reporter;

  private constructor(client: GitHubClient, reporter: Reporter) {
    this.client = client;
    this.reporter = reporter;
  }

  static async run(ctx: {
    eventName: string;
    payload: WebhookPayload;
    client: GitHubClient;
    workflowName: string;
    reporter: Reporter;
  }): Promise<void> {
    const action = new Action(ctx.client, ctx.reporter);
    if (ctx.eventName === 'push') {
      return action.handlePushEvent(ctx.workflowName, ctx.payload as PushEvent);
    } else {
      throw new Error(`unsupported event: ${ctx.eventName}`);
    }
  }

  private async handlePushEvent(
    workflowName: string,
    event: PushEvent,
  ): Promise<void> {
    if (!event.ref.startsWith('refs/heads/')) {
      throw new Error(`unsupported ref: ${event.ref}`);
    }

    const openPullRequests = await this.listOpenIncomingPullRequests(
      {owner: event.repository.owner.login, repo: event.repository.name},
      event.ref.substr(11 /* refs/heads/ */),
    );
    core.debug(
      `Open incoming PRs: ${JSON.stringify(openPullRequests, null, 2)}`,
    );

    const promises = openPullRequests.map(async pr =>
      (async () => {
        const pullRequest = await this.resolveUnknownMergeable(pr);

        switch (pullRequest.mergeable) {
          case 'UNKNOWN':
            core.warning(
              `PR #${pullRequest.number}: mergeablility still unknown`,
            );
          // fall through

          case 'MERGEABLE':
            await this.triggerReruns(workflowName, pullRequest);
            break;

          default:
            this.reporter.pullRequestIgnored(pullRequest);
        }
      })().catch(cause => {
        throw new Problem(
          `failed to trigger runs for PR #${pr.number}: ${
            cause instanceof Error ? cause.message : cause
          }`,
          {cause, pullRequest: pr},
        );
      }),
    );

    await awaitAll(promises, 'pullRequest', 'pullRequests');
    this.reporter.done();
  }

  private async listOpenIncomingPullRequests(
    repo: {owner: string; repo: string},
    branch: string,
  ): Promise<IncomingPullRequest[]> {
    const query = `
      query ($owner: String!, $repo: String!, $branch: String!) {
        repository(owner: $owner, name: $repo) {
          pullRequests(last: 100, baseRefName: $branch, states: OPEN) {
            nodes {
              ${prQueryFragment}
            }
          }
        }
      }
    `;

    const queryVars = {...repo, branch};
    core.debug(`Fetching open incoming PRs: ${JSON.stringify(queryVars)}`);
    const data = await this.client.graphql(query, queryVars);
    core.debug(`Fetched open incoming PRs: ${JSON.stringify(data)}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any).repository.pullRequests.nodes;
  }

  // Resolve pull requests until the mergeable state is no longer unknown.
  // https://stackoverflow.com/a/30620973
  private async resolveUnknownMergeable(
    pullRequest: IncomingPullRequest,
  ): Promise<IncomingPullRequest> {
    const prQuery = `
        query ($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              ${prQueryFragment}
            }
          }
        }
      `;

    const queryVars = {
      owner: pullRequest.repository.owner.login,
      repo: pullRequest.repository.name,
      number: pullRequest.number,
    };

    // Retry up to ten times
    for (
      let attempt = 1;
      pullRequest.mergeable === 'UNKNOWN' && attempt++ < 10;

    ) {
      // Delay the next call up to 5 seconds
      const delayMillis = Math.round(
        (Math.min(attempt - 1, 4) + Math.random()) * 1000,
      );
      core.debug(`Re-fetching PR #${pullRequest.number} in ${delayMillis} ms`);
      await new Promise<void>(resolve => setTimeout(resolve, delayMillis));
      const data = await this.client.graphql(prQuery, queryVars);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pullRequest = (data as any).repository.pullRequest;
    }

    core.debug(`Resolved mergeable state: ${JSON.stringify(pullRequest)}`);
    return pullRequest;
  }

  // Re-runs workflows for a given pull request.
  private async triggerReruns(
    workflowName: string,
    pullRequest: IncomingPullRequest,
  ): Promise<void> {
    const repo = {
      owner: pullRequest.repository.owner.login,
      repo: pullRequest.repository.name,
    };

    const promises = (
      await this.client.rest.actions.listWorkflowRunsForRepo({
        ...repo,
        event: 'pull_request',
        branch: pullRequest.headRef.name,
      })
    ).data.workflow_runs
      .filter(
        run =>
          run.name === workflowName &&
          run.pull_requests &&
          run.pull_requests.some(({number}) => number === pullRequest.number),
      )
      .map(async run =>
        this.triggerRerun(pullRequest, run).catch(cause => {
          throw new Problem(
            `failed to re-run workflow run ${run.id}: ${
              cause instanceof Error ? cause.message : cause
            }`,
            {cause, run},
          );
        }),
      );

    if (promises.length) {
      await awaitAll(promises, 'run', 'triggeredReruns');
    } else {
      this.reporter.noRunsFound(pullRequest);
    }
  }

  private async triggerRerun(
    pullRequest: IncomingPullRequest,
    run: WorkflowRun,
  ): Promise<void> {
    // Is it required to cancel any runs which are in non-terminal states?
    // https://docs.github.com/en/rest/reference/actions#re-run-a-workflow
    await this.client.request(
      'POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun',
      {
        owner: pullRequest.repository.owner.login,
        repo: pullRequest.repository.name,
        run_id: run.id,
      },
    );

    this.reporter.rerunTriggered(pullRequest, run);
  }
}

// Keep this in sync with IncomingPullRequest
const prQueryFragment = `
  number mergeable
  headRef { name }
  repository {
    name
    owner {login}
  }
`;

async function awaitAll<T>(
  promises: PromiseLike<T>[],
  errorProp: string,
  resultsProp: string,
): Promise<T[]> {
  const results: T[] = [];
  const errorMessages: string[] = [];

  for (const outcome of await Promise.allSettled(promises)) {
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
    } else {
      const error = outcome.reason;
      errorMessages.push(error.message);
      results.push({...error.opts[errorProp], error: error.cause});
    }
  }

  if (errorMessages.length) {
    const opts: {[key: string]: unknown} = {};
    opts[resultsProp] = results;
    throw new Problem(errorMessages.join(', '), opts);
  }

  return results;
}
