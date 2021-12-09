import * as core from '@actions/core';
import {IncomingPullRequest, WorkflowRun} from '../src/types';
import {beforeEach, describe, expect, jest, test} from '@jest/globals';
import {ActionsReporter} from '../src/reporter';
import {stub} from './stub';

jest.mock('@actions/core');

describe('ActionsReporter', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('logs ignored PRs', async () => {
    const underTest = new ActionsReporter();

    underTest.pullRequestIgnored(
      stub<IncomingPullRequest>({number: 1337, mergeable: 'foo'}),
    );
    underTest.done();

    expect(core.error).toHaveBeenCalledTimes(0);
    expect(core.info).toHaveBeenCalledTimes(1);
    expect(core.info).toHaveBeenCalledWith('Skipped PR #1337 in foo state.');
  });

  test('logs no runs found', async () => {
    const underTest = new ActionsReporter();

    underTest.noRunsFound(stub<IncomingPullRequest>({number: 1337}));
    underTest.done();

    expect(core.error).toHaveBeenCalledTimes(1);
    expect(core.info).toHaveBeenCalledTimes(0);
    expect(core.error).toHaveBeenCalledWith('No runs found for PR #1337.');
  });

  test('logs triggered reruns', async () => {
    const underTest = new ActionsReporter();

    underTest.rerunTriggered(
      stub<IncomingPullRequest>({number: 42}),
      stub<WorkflowRun>({id: 1337, status: 'completed'}),
    );
    underTest.done();

    expect(core.info).toHaveBeenCalledTimes(1);
    expect(core.error).toHaveBeenCalledTimes(0);
    expect(core.info).toHaveBeenCalledWith(
      'Triggered re-run of workflow run 1337 in completed state for PR #42.',
    );
  });

  test('logs no pull requests', async () => {
    const underTest = new ActionsReporter();

    underTest.done();

    expect(core.error).toHaveBeenCalledTimes(0);
    expect(core.info).toHaveBeenCalledTimes(1);
    expect(core.info).toHaveBeenCalledWith('No pull requests found.');
  });
});
