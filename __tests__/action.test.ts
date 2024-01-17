import * as core from '@actions/core';
import {IncomingPullRequest, WorkflowRun} from '../src/types';
import {afterEach, expect, jest, test} from '@jest/globals';
import {mockRandom, resetMockRandom} from 'jest-mock-random';
import {stub, stubFn} from './stub';
import {Action} from '../src/action';
import type {GitHubClient} from '../src/types';
import {Reporter} from '../src/reporter';
import type {RestEndpointMethodTypes} from '@octokit/plugin-rest-endpoint-methods';

jest.mock('@actions/core'); // silence debug logging

afterEach(() => {
  jest.useRealTimers();
  resetMockRandom();

  expect(core.info).toHaveBeenCalledTimes(0);
  expect(core.warning).toHaveBeenCalledTimes(0);
  expect(core.error).toHaveBeenCalledTimes(0);
});

test('rejects pull_request events', async () => {
  const ctx = stub<Context>({
    eventName: 'pull_request',
  });

  await expect(Action.run(ctx)).rejects.toThrow(
    'unsupported event: pull_request',
  );
});

test('rejects tags', async () => {
  const ctx = stub<Context>({
    eventName: 'push',
    payload: {ref: 'refs/tags/v1.0'},
  });

  await expect(Action.run(ctx)).rejects.toThrow(
    'unsupported ref: refs/tags/v1.0',
  );
});

// FIXME this adds to coverage?
test('reports no pull requests found', async () => {
  const client = {graphql: stubFn<GitHubClient['graphql']>()};
  const expectedGraphqlVars = [];
  const reporter = new RecordingReporter();
  const ctx = stub<Context>({
    eventName: 'push',
    payload: {
      ref: 'refs/heads/main',
      repository: {
        owner: {login: 'foo'},
        name: 'bar',
      },
    },
    client,
    reporter,
  });

  expectedGraphqlVars.push({
    owner: 'foo',
    repo: 'bar',
    branch: 'main',
  });
  client.graphql.mockResolvedValue({
    repository: {
      pullRequests: {
        nodes: [],
      },
    },
  });

  await expect(Action.run(ctx)).resolves.toBeUndefined();
  expect(client.graphql).toBeCalledTimes(expectedGraphqlVars.length);
  expect(client.graphql.mock.calls.map(call => call[1])).toEqual(
    expectedGraphqlVars,
  );
  expect(reporter.events).toEqual([{done: []}]);
});

test('retries if mergeable state is unknown', async () => {
  const client = {
    graphql: stubFn<GitHubClient['graphql']>(),
    rest: {
      actions: {
        listWorkflowRunsForRepo: stubFn<ListWorkflowRunsForRepo>(),
      },
    },
  };
  const expectedEvents: typeof reporter.events = [];
  const expectedGraphqlVars = [];
  const expectedListWorkflowRunsVars = [];
  let timeoutedCalls = 0;
  const reporter = new RecordingReporter();
  const ctx = stub<Context>({
    eventName: 'push',
    payload: {
      ref: 'refs/heads/main',
      repository: {
        owner: {login: 'foo'},
        name: 'bar',
      },
    },
    client,
    reporter,
  });

  const pr = (number: number, mergeable?: boolean): IncomingPullRequest =>
    stub<IncomingPullRequest>({
      number,
      mergeable:
        mergeable === true
          ? 'MERGEABLE'
          : mergeable === false
            ? 'UNKNOWN'
            : '-/-',
      headRef: {name: `branch${number}`},
      repository: {owner: {login: 'foo'}, name: 'bar'},
    });

  // list all the PRs
  expectedGraphqlVars.push({
    owner: 'foo',
    repo: 'bar',
    branch: 'main',
  });
  client.graphql.mockResolvedValueOnce({
    repository: {
      pullRequests: {
        nodes: [
          pr(1),
          pr(2, true),
          pr(3, false), // re-request!
          pr(4, false), // re-request!
        ],
      },
    },
  });

  // Ignore PR1
  expectedEvents.push({pullRequestIgnored: [pr(1)]});

  // No runs for PR2
  expectedListWorkflowRunsVars.push({
    owner: 'foo',
    repo: 'bar',
    event: 'pull_request',
    branch: 'branch2',
  });
  client.rest.actions.listWorkflowRunsForRepo.mockResolvedValueOnce(
    stub<ListWorkflowRunsResponse>({data: {workflow_runs: []}}),
  );
  expectedEvents.push({noRunsFound: [pr(2, true)]});

  // Re-request PR3
  ++timeoutedCalls;
  expectedGraphqlVars.push({owner: 'foo', repo: 'bar', number: 3});
  client.graphql.mockResolvedValueOnce({
    repository: {pullRequest: pr(3, true)},
  });

  // Re-request PR4
  ++timeoutedCalls;
  expectedGraphqlVars.push({owner: 'foo', repo: 'bar', number: 4});
  client.graphql.mockResolvedValueOnce({repository: {pullRequest: pr(4)}});

  // Ignore PR4
  expectedEvents.push({pullRequestIgnored: [pr(4)]});

  // No runs for PR3
  expectedListWorkflowRunsVars.push({
    owner: 'foo',
    repo: 'bar',
    event: 'pull_request',
    branch: 'branch3',
  });
  client.rest.actions.listWorkflowRunsForRepo.mockResolvedValueOnce(
    stub<ListWorkflowRunsResponse>({data: {workflow_runs: []}}),
  );
  expectedEvents.push({noRunsFound: [pr(3, true)]});

  // Done
  expectedEvents.push({done: []});

  jest.useFakeTimers();
  mockRandom([...Array(timeoutedCalls).keys()].map(x => x * 0.1)); // keep this increasing so that timeouts will be executed in the same order in which they were placed
  const runPromise = expect(Action.run(ctx))
    .resolves.toBeUndefined()
    .then(() => true);

  while (!(await Promise.race([runPromise, false]))) {
    jest.runAllTimers();
  }

  expect(client.graphql.mock.calls.map(args => args[1])).toEqual(
    expectedGraphqlVars,
  );
  expect(
    client.rest.actions.listWorkflowRunsForRepo.mock.calls.map(args => args[0]),
  ).toEqual(expectedListWorkflowRunsVars);

  expect(reporter.events).toEqual(expectedEvents);
});

test('re-runs workflows', async () => {
  const client = {
    graphql: stubFn<GitHubClient['graphql']>(),
    request: stubFn<GitHubClient['request']>(),
    rest: {
      actions: {
        listWorkflowRunsForRepo: stubFn<ListWorkflowRunsForRepo>(),
      },
    },
  };
  const expectedEvents: typeof reporter.events = [];
  const expectedGraphqlVars = [];
  const expectedListWorkflowRunsVars = [];
  const reporter = new RecordingReporter();
  const ctx = stub<Context>({
    eventName: 'push',
    payload: {
      ref: 'refs/heads/main',
      repository: {
        owner: {login: 'foo'},
        name: 'bar',
      },
    },
    client,
    workflowName: 'Workflow',
    reporter,
  });

  const prOne: IncomingPullRequest = {
    number: 1,
    mergeable: 'MERGEABLE',
    headRef: {name: 'branch1'},
    repository: {owner: {login: 'foo'}, name: 'bar'},
  };

  // list all the PRs
  expectedGraphqlVars.push({
    owner: 'foo',
    repo: 'bar',
    branch: 'main',
  });
  client.graphql.mockResolvedValueOnce({
    repository: {pullRequests: {nodes: [prOne]}},
  });

  // The runs for PR1
  expectedListWorkflowRunsVars.push({
    owner: 'foo',
    repo: 'bar',
    event: 'pull_request',
    branch: 'branch1',
  });
  client.rest.actions.listWorkflowRunsForRepo.mockResolvedValueOnce(
    stub<ListWorkflowRunsResponse>({
      data: {
        workflow_runs: [
          /* Wrong workflow: */
          {
            id: 7,
            name: 'not my workflow',
            pull_requests: [{number: 1}],
          },
          /* Wrong pull request: */
          {
            id: 42,
            name: 'Workflow',
            pull_requests: [{number: 4711}],
          },
          /* This matches: */
          {
            id: 1337,
            name: 'Workflow',
            pull_requests: [{number: 2}, {number: 1}],
          },
        ] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      },
    }),
  );
  expectedEvents.push({
    rerunTriggered: [
      prOne,
      stub<WorkflowRun>({
        id: 1337,
        name: 'Workflow',
        pull_requests: [{number: 2}, {number: 1}] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      }),
    ],
  });

  // Done
  expectedEvents.push({done: []});

  await expect(Action.run(ctx)).resolves.toBeUndefined();
  expect(client.graphql.mock.calls.map(args => args[1])).toEqual(
    expectedGraphqlVars,
  );
  expect(
    client.rest.actions.listWorkflowRunsForRepo.mock.calls.map(args => args[0]),
  ).toEqual(expectedListWorkflowRunsVars);

  expect(reporter.events).toEqual(expectedEvents);
});

test('collects errors', async () => {
  const client = {
    graphql: stubFn<GitHubClient['graphql']>(),
    request: stubFn<GitHubClient['request']>(),
    rest: {
      actions: {
        listWorkflowRunsForRepo: stubFn<ListWorkflowRunsForRepo>(),
      },
    },
  };
  const reporter = new RecordingReporter();
  const ctx = stub<Context>({
    eventName: 'push',
    payload: {
      ref: 'refs/heads/main',
      repository: {
        owner: {login: 'foo'},
        name: 'bar',
      },
    },
    client,
    workflowName: 'Workflow',
    reporter,
  });

  // list all the PRs
  client.graphql.mockResolvedValueOnce({
    repository: {
      pullRequests: {
        nodes: [
          {
            number: 1,
            mergeable: 'MERGEABLE',
            headRef: {name: 'branch1'},
            repository: {owner: {login: 'foo'}, name: 'bar'},
          },
        ],
      },
    },
  });

  // The runs for PR1
  client.rest.actions.listWorkflowRunsForRepo.mockResolvedValueOnce(
    stub<ListWorkflowRunsResponse>({
      data: {
        workflow_runs: [
          {id: 1336, name: 'Workflow', pull_requests: [{number: 1}]},
          {id: 1337, name: 'Workflow', pull_requests: [{number: 1}]},
        ] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      },
    }),
  );

  // Triggering reruns throws an error
  client.request
    /* run 1336: */ .mockResolvedValueOnce(stub({}))
    /* run 1337: */ .mockRejectedValue(new Error('foobar'));

  await expect(Action.run(ctx)).rejects.toMatchObject({
    message:
      'failed to trigger runs for PR #1: failed to re-run workflow run 1337: foobar',
  });

  expect(client.request).toHaveBeenNthCalledWith(
    1,
    'POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun',
    expect.objectContaining({run_id: 1336}),
  );
  expect(client.request).toHaveBeenNthCalledWith(
    2,
    'POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun',
    expect.objectContaining({run_id: 1337}),
  );

  expect(reporter.events).toEqual([
    {
      rerunTriggered: [
        expect.objectContaining({number: 1}),
        expect.objectContaining({id: 1336}),
      ],
    },
  ]);
});

type ListWorkflowRunsForRepo =
  GitHubClient['rest']['actions']['listWorkflowRunsForRepo'];
type ListWorkflowRunsResponse =
  RestEndpointMethodTypes['actions']['listWorkflowRunsForRepo']['response'];

type Context = Parameters<(typeof Action)['run']>[0];

class RecordingReporter implements Reporter {
  events: (
    | {pullRequestIgnored: Parameters<Reporter['pullRequestIgnored']>}
    | {rerunTriggered: Parameters<Reporter['rerunTriggered']>}
    | {noRunsFound: Parameters<Reporter['noRunsFound']>}
    | {done: Parameters<Reporter['done']>}
  )[] = [];

  pullRequestIgnored(pullRequest: IncomingPullRequest): void {
    this.events.push({pullRequestIgnored: [pullRequest]});
  }

  rerunTriggered(pullRequest: IncomingPullRequest, run: WorkflowRun): void {
    this.events.push({rerunTriggered: [pullRequest, run]});
  }

  noRunsFound(pullRequest: IncomingPullRequest): void {
    this.events.push({noRunsFound: [pullRequest]});
  }

  done(): void {
    this.events.push({done: []});
  }
}
