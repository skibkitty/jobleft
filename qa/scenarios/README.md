# Replay scenarios (run on Windows CI against the installed app, so every area's checks run on both systems)

One file per area: scenarios/<area>.mjs. Plain Node 24 ES module, no packages. Reads its target from the environment:

| Variable | Meaning |
|---|---|
| JOBLEFT_QA_URL | the page URL with the token in the hash (open it with the driver) |
| JOBLEFT_QA_API | http://127.0.0.1:<port>/api/v1 |
| JOBLEFT_QA_TOKEN | the launch token (header x-jobleft-token) |
| JOBLEFT_QA_FIXTURES | folder with the resume PDFs/DOCX and LinkedIn CSVs |
| JOBLEFT_QA_SHOTS | folder to write screenshots into (created for you) |
| JOBLEFT_QA_STATE | `fresh` (first run, no jobs yet) or `golden` (jobs crawled, a profile exists) |
| JOBLEFT_CHROME | Chrome binary path when not at the default place (the drivers read it) |

Rules: import the driver relative to the script (`new URL('../bin/driver.mjs', import.meta.url)`); no Mac-only paths;
print one line per check: `CHECK ok <name>` or `CHECK FAIL <name>: <why>`; exit code 1 when any check failed, 0
otherwise; finish in under 10 minutes; never assume a specific job title or company exists (the Windows run crawls
live boards; assert invariants: counts agree, filters are exact against the facts each card shows, nothing is lost
after a reload, banned words absent); close Chrome in a `finally`. Skip a check (print `CHECK skip <name>: <why>`)
when the state does not allow it (for example the extension needs the practice server: start it yourself from
`../bin/practice-server.mjs` with child_process and stop it after).

## The failure side channel

`run-all.mjs` cannot learn a failed check's name from stdout: the `why` is whitespace-collapsed and truncated, and a
name can itself contain `": "` (for example `banned-words: job detail` reads as name `banned-words`, why `job detail:
…`). So every scenario also appends each failure to the file named by `JOBLEFT_QA_CHECKS`, one JSON object per line:

```js
import { recordFailure } from '../bin/checks.mjs';
const fail = (name, why) => { recordFailure(name); console.log(`CHECK FAIL ${name}: ${why}`); };
```

Two rules make this trustworthy:

- **`fail()` is the only place a failure is recorded.** `run-all.mjs` cross-checks the number of `CHECK FAIL` lines
  against the number of records; a mismatch means a scenario printed a failure without going through `fail()`, and the
  run fails. Do not print `CHECK FAIL` by hand.
- **Keep the check name free of the failure text.** Put the varying part (a job id, a screen name) in `why`. A name
  built at runtime from live data cannot be baselined.

`run-all.mjs` sets `JOBLEFT_QA_CHECKS` itself, to a fresh directory per invocation. With it unset, `recordFailure` is a
no-op, so running one scenario from a terminal behaves exactly as before.

## The known-failure baseline

`../known-failures.json` lists the failures that are known and not yet fixed. `run-all.mjs` tolerates a failed check
**only** when its scenario and name match an entry — exactly, or by prefix when the entry's name ends in `*`. Any other
failure fails the run.

The runner is fail-closed. A scenario that cannot start, is killed by its 12-minute timeout, exits with an unexpected
code, or leaves a result that does not add up fails the run *even if every check it did report is baselined* — a broken
runner must never read as "only the known failures again". A scenario file that does not exist fails too.

An entry that did **not** fail is reported as stale and never fails a run, so fixing a bug cannot break an unrelated
change. Stale entries are only reported for scenarios that actually ran, which keeps a partial run
(`run-all.mjs feed`) quiet. Remove an entry when its problem is fixed.

Adding an entry needs the check's real name from the source, not from a log line: the log cannot show you where the
name ends. Several entries in the baseline are exact strings that the scenario builds from live crawl data — check
before you trust one.
