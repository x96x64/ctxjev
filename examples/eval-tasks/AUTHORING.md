# Writing an eval task (format 2)

The written spec for anyone adding a task for Round 2, including the separate agent that writes
eight of them without seeing any scorer code (decision Q3 in
`docs/design/round-2-scoring-and-evaluation.md`). It says what a task must contain and what the
harness checks; it says nothing about how ctxjev scores, and a task author shouldn't need to know.

A worked example that passes every check lives outside this directory, so no eval reads it:
`packages/core/eval/fixtures/tasks/format2-demo/`.

## What a task is

A small repository with a planted problem, a conversation that investigates it, and hidden tests
that check the fix. An agent later gets a shortened version of that conversation and must finish
the fix; the hidden tests decide if it did.

```
<task>/
  task.json            the conversation and the repository's history (below)
  template/            the repository as it is when the conversation starts (after the last commit)
  history/*.diff       one unified diff per commit after the first (format 2)
  hidden/*.test.js     acceptance tests, never shown to the agent (node:test)
  solution/            the files a correct fix changes, in their fixed form
```

## task.json

```json
{
  "format": 2,
  "split": "holdout2",
  "language": "ja",
  "author": "spec-only-agent",
  "goal": "The first message: the symptom, where to look, and 'investigate only, no edits yet'.",
  "prompts": [
    "A follow-up that states constraints. Still no edits.",
    "A follow-up that changes or adds one. Still no edits.",
    "Go ahead and implement the fix now, then run the tests."
  ],
  "history": [
    { "message": "Initial version", "date": "2026-03-02T09:00:00+09:00", "author": "A. Person" },
    { "message": "What this commit did", "date": "…", "author": "…", "diff": "history/01-name.diff" }
  ]
}
```

- `format`: always 2 for new tasks.
- `split`: whatever the preregistration names (Round 2's new held-out set).
- `language`: `en` or `ja`. Everything in a Japanese task is Japanese: the goal, the prompts, the
  commit messages, and later the probes (see below).
- `author`: who wrote the task: `spec-only-agent` for the agent given only this document, a name
  otherwise. Results are reported by author.
- `history`: the repository's commits, oldest first, with fixed dates. **Every commit after the
  first has a `diff`**: a real change, made in a scratch repository and saved with `git diff`
  (or `git diff --cached` for new files). `template/` is the state after the last commit;
  `setup.mjs` undoes the diffs to get the first commit, then replays them. If any commit message
  or later question says "commit X introduced Y", commit X's diff must actually contain Y.

## What the task has to test

- **The facts the fix needs must come from tool output, not from what the user says.** A value in
  a log line, an entry in a config file, a failing test's expected value: something the agent can
  only know by having read it earlier in the conversation. At most a third of tasks may be
  solvable from the user's messages alone.
- Those facts must appear **before** the final "go ahead" prompt, and nowhere after it.
- The hidden tests check the fix, and every constraint the user stated, including the one the
  later prompt changed.
- A "must not change" check (a config file ops parses, an error string clients match on) compares
  against the pristine copy the harness sets up after the agent is done, never with `git diff`,
  which an agent can get past by committing:

  ```js
  const pristine = process.env.CTXJEV_PRISTINE_REPO
  assert.ok(pristine, 'CTXJEV_PRISTINE_REPO is set by the eval harness')
  assert.equal(readFileSync('config/limits.json', 'utf8'), readFileSync(join(pristine, 'config/limits.json'), 'utf8'))
  ```
- Logs and fixtures in `template/` must agree with what the template's code actually does. (In
  Round 1, `room-booking`'s log said a request succeeded that its code would reject.)
- Keep the repository small (a few files of plain JavaScript, no dependencies), with its own
  `test/*.test.js` that pass on the template.

## Probes

After a session is recorded, its facts are written down as probes: a question and the fact that
answers it, with the entries that state it (`packages/core/eval/label-session.mjs`). In a Japanese
task, every probe's question and fact are written in Japanese; `label-session.mjs` and
`check-sessions.mjs` refuse otherwise.

## Checks to run before committing a task

```bash
node examples/eval-tasks/verify.mjs            # template tests pass; hidden fail on template, pass with solution;
                                               # format 2: history replays with real diffs, no git-diff checks
cd packages/core && node eval/tasks.mjs --selftest --task <task>   # the solution applied through the agent's tools passes
```
