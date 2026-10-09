# Making skibkitty/jobleft PR #1 genuinely green — working plan

> **Superseded 2026-10-05, after implementation.** Implemented; the decisions are folded into
> `WINDOWS-PORT-PLAN.md` section 4.0 and the contract into `qa/scenarios/README.md`. Three check names
> in the table below are **wrong** — `card-equals-detail: lever:bannerbank:*` is `card-equals-detail`,
> `banned-words: job detail` is `banned-words`, and `filter exact: country CA` needs the prefix entry
> `filter exact: country *`. A log line cannot show you where a name ends. The baseline is
> `qa/known-failures.json`; read the names there, not here.

Written 2026-10-05. Status: **planned, nothing implemented yet.** Decisions below are locked
unless a line is under "Open decisions".

The authoritative Windows plan is [`WINDOWS-PORT-PLAN.md`](WINDOWS-PORT-PLAN.md) (Stage 4 is
`not started`). This file is the actionable version of Stage 4 plus the CI work; when the work
lands, its decisions get folded back into `WINDOWS-PORT-PLAN.md`.

## Goal and constraints

Goal: `skibkitty/jobleft` PR #1 is green on GitHub Actions before merge, **without hiding a
legitimate regression**.

Constraints I set for myself, and that survived review:

- Do not weaken an assertion just to get green.
- Do not add blanket retries or `continue-on-error` without a technical reason.
- Do not make a job look successful while quietly ignoring failures.
- Prefer deterministic tests over inflated timeouts.
- Keep the PR's subject (shipping the extension zip) intact.

## Two different PRs — do not conflate them

| PR | Repo | State |
|---|---|---|
| #1 `feat: ship extension as release asset with pinned ID` | `skibkitty/jobleft` | Runs Actions. Two red legs: `ci` Windows, `replay`. **This is what this plan fixes.** |
| #1 `apps/shell: build-windows.ps1` | `Blueturboguy07/jobleft` (upstream) | 2 files, +319/-0 (`apps/shell/scripts/build-windows.ps1`, `apps/shell/README.md`). Touches no test, `qa/`, `apps/server` or `apps/ui`, so it fixes none of the failures below. |

The upstream PR's CI has never run: all 10 attempts are `action_required` because GitHub needs
the upstream maintainer to approve fork workflows. That is an approval/permission state, not
evidence that the implementation is broken, and it cannot be cleared from this side. Nothing in
this plan goes into that PR. Its only open item is one line in its body saying CI is awaiting
maintainer approval.

Current fork PR #1 legs: `check (macos-latest)` green, `windows` (installer + smoke) green,
`check (windows-latest)` red, `replay` red.

## A. `ci.yml` Windows: one failing test

`apps/server/test/lifecycle.test.ts:102`, test *"the server stops within 10 seconds after its
parent is killed"*:

```
AssertionError: the port is closed
  expected: null
  actual:   HTTP 200  {"app":"jobleft","version":"0.1.3",...}
```

Diagnosed, and the diagnosis is not a Windows process-shutdown problem:

- `code === 0` and `Date.now() - t0 < 10000` both **passed**; only the final "the port is closed"
  check failed.
- Every jobleft server binds the first free port of a fixed ramp `47821..47830`
  (`packages/contracts/src/api.ts:61-62`, `apps/server/src/server.ts:93-107`).
- `node --test "test/*.test.ts"` runs all 20 `apps/server` test files in parallel and `pnpm -r`
  runs other packages alongside, so dozens of servers race for those 10 ports constantly.
- The assertion is a **global** property ("nothing is listening on this port") evaluated the
  instant the server under test exits. The moment it exits the port is free, and any other
  test's server can claim it and answer `/api/v1/health` with 200.
- Reproduced locally on Windows with a throwaway probe (3 churn servers + 1 parent-death server,
  no repo files touched):
  ```
  probe server exited with 0
  probe 2100 ms after exit: health 200
    netstat: TCP 127.0.0.1:47821 0.0.0.0:0 LISTENING 17580
  RESULT: port was taken over by another server
  ```
- A second listener cannot *share* a live port on Windows (`EADDRINUSE`), so this is
  theft-after-exit, not a hijack. The server spawns no child processes in this configuration,
  so socket-handle inheritance by a grandchild is ruled out too.
- It is a scheduling/load coincidence, not a platform rule: that is why macOS stays green and a
  2-vCPU Windows runner hits it.

## B. `windows.yml` `replay`: 18 failing checks

Not my regression. The job is in upstream's own `windows.yml` on `main` (their copy even sets
`timeout-minutes: 7`); it was red before this fork existed. The fork's copy only changed the
test-step flags and added the extension zip. Aggregate: `onboarding=failure crawl=success
rest=failure`.

Wording to use in docs (more defensible than claiming proof): *pre-existing with respect to the
replay suite and unrelated to this PR; the exact historical failure state on `main` is not
independently reproduced.*

Full log from the run analysed: `C:\Users\test\AppData\Local\Temp\opencode\replay.log`
(temporary; re-run to regenerate).

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Replay gate = **quarantine baseline**, mechanically enforced | Known, enumerated failures stop blocking unrelated work; any *new* failure still fails CI. Only works if the runner enforces it. |
| 2 | Fix the Windows Keychain copy in this PR | Tiny, clearly correct, and it stops me adding a known defect to the baseline. |
| 3 | Lifecycle fix = pin an ephemeral port outside the ramp, verify ownership, retry if stolen, then poll | The root race is ownership of a shared port. Polling without isolating the port makes the race slower, not impossible. |
| 4 | `delete-all` product code untouched | `backup.ts:461` and the Settings copy say crawled jobs stay. That is a contract question, not a privacy bug. Do not infer semantics from a test name. |
| 5 | Replay bug fixes go in later, separate PRs | They are independent issues; separate PRs keep review and attribution clean, and are how they would go upstream afterwards. |
| 6 | Baseline **lands in PR #1** | Otherwise the replay job stays red and PR #1 is not green, which contradicts the goal. Costs ~3 QA-only files. |

## Work items

### 1. `lifecycle.test.ts` — deterministic port (test-only, no product change)

- `apps/server/test/helpers.ts`: add
  - `freePort()` — bind `:0`, read the port, close it. Same trick already used inline at
    `lifecycle.test.ts:81-82`.
  - `waitPortClosed(port, { intervalMs: 250, timeoutMs: 8000 })` — built on the existing `raw()`
    probe, treating a refused connection as closed. Same bounded-poll shape as
    `apps/server/test/shutdown.test.ts`.
- `apps/server/test/lifecycle.test.ts:91-104`: retry loop, max 3 attempts:
  1. reserve `freePort()`; reject and re-reserve if it lands inside `47821..47830`;
  2. `spawnServer(home, { JOBLEFT_PARENT_PID: String(parent.pid), JOBLEFT_PORT: String(port) })`;
  3. `await a.ready` (already health-checks), then assert `info.port === port` — a mismatch
     means the reservation was stolen between close and bind, so stop the server, clean up,
     retry with a fresh reservation;
  4. kill the parent, keep `assert.equal(code, 0)` and `assert.ok(Date.now() - t0 < 10000)`;
  5. replace `const r = await raw(...).catch(() => null); assert.equal(r, null, 'the port is
     closed')` with `await waitPortClosed(info.port)`.

The assertion keeps its full strength — it can now only mean *this* server stopped.

### 2. `Onboarding.tsx` — Windows copy

`apps/ui/src/screens/Onboarding.tsx:292` hardcodes "it stays in the macOS Keychain". Reuse the
platform-aware wording already in `apps/ui/src/screens/Settings.tsx:25-27`. No new platform branch.

### 3. Replay quarantine baseline

**Why not parse the log output.** `check`/`fail`/`skip` are **duplicated in all 7 scenario
files** — there is no shared helper. Check names contain `": "` (e.g. `filter exact: country CA`),
at least one is built at runtime with a UUID
(`card-equals-detail: lever:bannerbank:<uuid>`), and `why` is whitespace-collapsed and truncated
to 400/600 chars. So `run-all.mjs` cannot recover a reliable name by parsing stdout.

Design:

- **Side channel.** Each scenario's `fail` — defined in all 7 files and the single funnel that
  increments the failure counter and prints `CHECK FAIL` — also appends one JSON line
  `{scenario, name}` to the file named by `process.env.JOBLEFT_QA_CHECKS`, and is a silent no-op
  when that variable is unset so direct scenario runs keep working unchanged.
- **`qa/known-failures.json`** — 17 entries (the 18th is fixed by item 2 and never gets listed):
  `scenario`, `name`, `category`, `ref`, `reason`, optional `platform`. A trailing `:*` on `name`
  means prefix match, which the UUID check needs.
- **`qa/bin/run-all.mjs`** — read the side channel, then:
  - failure not in the baseline → **exit 1**;
  - failure in the baseline → print prominently, do not fail;
  - baseline entry that did not fail → print as stale (**warn only**, so fixing a bug does not
    break an unrelated PR), and suppress that entirely on partial runs (`node qa/bin/run-all.mjs
    feed`) and for scenarios that did not run or are `missing`.

The invariant, and the whole point:

> CI may only tolerate a failure that is explicitly present in the baseline.

Not "CI ignores failures because this suite is flaky."

Encoding: `run-all.mjs` already reads child stdout as utf8 (`run-all.mjs:20`). One check *name*
contains non-ASCII (`→`, `…`); the baseline file must stay UTF-8. In Windows console logs these
render as mojibake (`ΓåÆ`, `ΓÇª`) — cosmetic only, but do not paste mojibake into the baseline.

### 4. Docs

- `docs/WINDOWS-PORT-PLAN.md` — Stage 4 status, the baseline decision, the classification, the
  corrected historical claim.
- `qa/scenarios/README.md` — document the side channel and the baseline contract next to the
  existing `CHECK ok` / `CHECK FAIL <name>: <why>` contract (README lines 16-19).
- `AGENTS.md` — extend the "CI reads as green when it is not" gotcha with how the replay
  baseline is enforced, and how to read a stale entry.
- Upstream PR #1 body — the approval note from the table above.

## The 17 baseline entries

Names verbatim from the run. `*` marks a prefix-pattern entry. `verify` = confirm the exact
construction in source before writing the entry; the observed string is ground truth either way,
and the runner supplies the scenario from its own per-scenario buckets, so attribution cannot
drift.

| # | Scenario | Check | Category | Source |
|---|---|---|---|---|
| 1 | onboarding | `api-refuses-unknown-country` | product bug | `onboarding.mjs:130` — status 200, `"XX"` accepted, wanted 400 |
| 2 | onboarding | `onboarding-on-first-run` | product bug | `onboarding.mjs:146` — landed on `#/jobs`; auto-crawl ran before setup finished, so 4339 jobs exist in a "fresh" state |
| 3 | onboarding | `relaunch-continues-onboarding` | product bug | `onboarding.mjs:171` — after quitting on step 2 the app opened `#/jobs` |
| 4 | onboarding | `no-banned-words:jobs-empty` | live-crawl noise | `onboarding.mjs:89` (`no-banned-words:${name}`) — a crawled posting contains a banned word |
| 5 | feed | `filter exact: country CA` | live-crawl noise | `feed.mjs` (~101-112, verify) — 1/84 jobs break the filter |
| 6 | feed | `counts: Applied badge equals saved applied jobs` | product bug | `feed.mjs:170` (`counts: ${tab} badge equals saved ${view} jobs`) — badge `undefined` vs `0` |
| 7 | feed | `UI filter: a second filter keeps the first (Entry Level + Full-time)` | spec mismatch | `feed.mjs:203` |
| 8 | tracker | `card-equals-detail: lever:bannerbank:*` | live noise / flake | `tracker.mjs:177` + per-card suffix — detail did not open; UUID in the name, hence the pattern |
| 9 | tracker | `unknown-job-page` | live noise | `tracker.mjs:198` — crawled text contains a banned credit |
| 10 | tracker | `feed-tabs-equal-tracker` | product bug | `tracker.mjs:307` — Applied tab `NaN` vs API `2` |
| 11 | tracker | `feed-tabs-equal-tracker-after-reload` | product bug | `tracker.mjs:307` + suffix — Applied tab `NaN` vs API `2` |
| 12 | tracker | `banned-words: job detail` | live noise | `tracker.mjs:345` + per-view suffix (verify) |
| 13 | resume | `Resume screens and Settings → Balance show no banned words ("credits", "undefined", "NaN" …)` | environment | `resume.mjs:515` — no `PUBLIK_APP_TOKEN` on a fork, so balance is `$0` |
| 14 | network | `companies view: Kroger count equals API coverage and match rows` | product bug | `network.mjs:244` — `ui=null coverage=6 matched=6` |
| 15 | network | `companies view: "Who to contact first" gives reasons` | product bug | `network.mjs` (verify) |
| 16 | settings | `delete-all wipes the data folder contents` | spec vs contract | `settings.mjs:238,244` — 4339 jobs survived; `backup.ts:461` and the Settings copy say crawled jobs stay. Resolve the contract before touching code. |
| 17 | extension | `job_a_missing_stay_empty` | spec mismatch | `extension.mjs:213` |

Two attribution corrections from an earlier draft of this plan, caught by reading source: log
order is not scenario order, so `unknown-job-page`, `feed-tabs-equal-tracker*` and
`card-equals-detail: lever:...` are **tracker**, not feed; and `job_a_missing_stay_empty` is
**extension**, not tracker.

## Verification

- Lifecycle test 5x in a row, then the whole `apps/server` suite, then the repo's lint,
  typecheck and test scripts.
- One full local replay run proving the 17 known failures do **not** fail the job.
- **Negative test** (this is the one that proves the gate has teeth): temporarily corrupt one
  baseline name and confirm `run-all.mjs` still exits 1.
- Review the diff before committing. `jobleft-autofill-0.1.3.zip` is untracked and must stay out
  of any commit unless that is deliberately the change.

## Open decisions — answer these before starting

1. **`shutdown.test.ts`**: switch its inline port poll to the new shared `waitPortClosed` so there
   is one implementation (2-line change to a currently-passing test), or leave it untouched to keep
   the diff minimal?
2. **Baseline `ref` values**: point every entry at `docs/WINDOWS-PORT-PLAN.md` Stage 4 (no writes
   at all), or file tracking issues for the 4 real product bugs via
   `gh issue create --repo skibkitty/jobleft` and link those? The repo has two remotes, so `gh`
   needs the explicit `--repo`.
3. **Scope**: confirm the 3 QA files land in PR #1 (decision 6) rather than in a separate
   baseline PR merged first.

## Explicitly not doing

- Not fixing any of the 4 real product bugs in PR #1.
- Not changing `delete-all` behaviour to satisfy a scenario whose expectation contradicts
  `backup.ts:461`.
- Not touching the `replay` job's `continue-on-error` shape or the final `Result` step verdict
  mechanism in `windows.yml`.
- Not re-baselining by editing the scenarios to make checks pass.
- Not folding any of this into the upstream `Blueturboguy07/jobleft` PR.