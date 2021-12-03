# Re-run GitHub workflows for incoming Pull Requests

In order to prevent "semantic merge conflicts", each pull request needs to be
tested based on its potential merge commit with its target branch. A
full-fledged solution to this would be to use a proper [merge
pipeline][gh-bors-ng]. While a merge pipeline is a really powerful tool that
becomes a game changer once a project reaches a certain size, it brings its own
complexity.

Small projects can get along with a simpler solution. When using GitHub Actions
triggered by the [`pull_request`][action-event-pr] event, GitHub will use the
potential merge commit by default. But those events aren't triggered when the
target branch changes. This is the problem that this action tries to address.
Every time a push to some repository branch happens, this GitHub Action may be
used to find all the open and mergeable pull requests targeting the branch being
pushed to, and trigger a re-run of a certain workflow on those pull requests.

Note that this is not entirely bullet-proof. There are several edge cases in
which bad pull requests can slip through. If that's not acceptable, please
consider a more elaborate approach than this one. This is a proof-of-concept
that might be good enough for some folks. Some edge cases are:

- Pull requests get merged in quick succession:  
  Pull requests that were passing all of their status checks before the update
  of the target branch will remain in a mergeable state until the GitHub Action
  for the target branch triggered their respective builds. Usually, this time
  window is quite small, say, under a minute, but if the triggering GitHub
  action fails or gets stuck in the execution queue, this can go unnoticed for
  quite a while.
- Stale pull requests:  
  GitHub's docs [mention][gh-docs-rerun] that a GitHub workflow run can only be
  re-run up to 30 days after the triggering event event has occurred. So
  whenever a pull request isn't touched for longer than that period, the re-run
  cannot be triggered anymore and some other action needs to be taken.

[gh-bors-ng]: https://github.com/bors-ng/bors-ng
[action-event-pr]: https://docs.github.com/en/actions/learn-github-actions/events-that-trigger-workflows#pull_request
[gh-docs-rerun]: https://docs.github.com/en/actions/managing-workflow-runs/re-running-workflows-and-jobs#re-running-all-the-jobs-in-a-workflow

## Code in Main

First, you'll need to have a reasonably modern version of `node` handy. The CI
builds use Node 12, currently.

Install the dependencies

```sh
$ npm install
```

Build the typescript and package it for distribution

```sh
$ npm run build && npm run package
```

Run the tests :heavy_check_mark:

```sh
$ npm test

 PASS  ./index.test.js
  ✓ throws invalid number (3ms)
  ✓ wait 500 ms (504ms)
  ✓ test runs (95ms)

...
```
