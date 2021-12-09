import * as core from '@actions/core';
import {IncomingPullRequest, WorkflowRun} from './types';

/** Receives progress information about this action. */
export interface Reporter {
  pullRequestIgnored(pullRequest: IncomingPullRequest): void;

  rerunTriggered(pullRequest: IncomingPullRequest, run: WorkflowRun): void;

  noRunsFound(pullRequest: IncomingPullRequest): void;

  done(): void;
}

/** Logs progress to the GitHub Actions console. */
export class ActionsReporter implements Reporter {
  private interactions = false;

  pullRequestIgnored(pullRequest: IncomingPullRequest): void {
    this.interactions = true;
    core.info(
      `Skipped PR #${pullRequest.number} in ${pullRequest.mergeable} state.`,
    );
  }

  rerunTriggered(
    pullRequest: IncomingPullRequest,
    run: {id: number; status: string | null},
  ): void {
    this.interactions = true;
    core.info(
      `Triggered re-run of workflow run ${run.id} in ${run.status} state for PR #${pullRequest.number}.`,
    );
  }

  noRunsFound(pullRequest: IncomingPullRequest): void {
    this.interactions = true;
    core.error(`No runs found for PR #${pullRequest.number}.`);
  }

  done(): void {
    if (!this.interactions) {
      core.info(`No pull requests found.`);
    }
  }
}
