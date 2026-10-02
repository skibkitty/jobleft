# Windows port: plan and state

Written 2026-10-02 by a fork of `blueturboguy07/jobleft`. This is the handoff document for
the Windows work. Read it before touching anything, and update it as stages complete.

- **Fork**: `skibkitty/jobleft` (this repo, `origin`)
- **Upstream**: `blueturboguy07/jobleft` (`upstream`, read-only for now)
- **Baseline commit**: `09f73de` ("publik copy: the balance starts at $0.00 ...")
- **Upstream state when surveyed**: last push 2026-09-28; both `ci.yml` and `windows.yml` red.

## TL;DR

The Windows build **already exists and works**. `jobleft_0.1.3_x64-setup.exe` is published on
the v0.1.3 release, and the `windows` job in `.github/workflows/windows.yml` is green
end-to-end: typecheck, all 17 unit suites, sidecar pack, NSIS installer, silent install,
launch, health check, clean shutdown.

What was red is everything *around* it:

1. `ci.yml`'s Windows leg failed on **one flaky timing assertion**. **Fixed** — see 2a.
2. `windows.yml`'s `replay` job (the black-box QA harness) failed **18 checks**, of which ~5 are
   genuinely Windows-specific. **Still to do** — see Stage 4.
3. `windows.yml`'s `replay` job **printed the launch token into the log**. **Fixed** — see 2c.

Stage 2 is done and uncommitted. Stage 3 is done: the local installer builds and passes the same smoke test CI runs.
Stage 1 Route A is proven by it.

## Stage status

| Stage | What | Status |
| ----- | ---- | ------ |
| 0 | Fork + clone | **done** 2026-10-02 |
| 1 | Run it on Windows (no Rust needed) | **done** 2026-10-02 (Route A, via the locally built installer; Route C not done) |
| 2 | Green the Windows test legs | **done** 2026-10-02 (uncommitted) |
| 2c | Stop leaking the launch token into CI logs | **done** 2026-10-02 (uncommitted) |
| 3 | Build the installer locally | **done** 2026-10-02 (uncommitted): build + smoke both green |
| 4 | Fix the Windows-specific replay failures | not started |
| 5 | Decide upstream PRs | not started |
| 6 | Windows ACL for `run/server.json` | not started (agreed to keep separate) |

---

## Verified findings

These were confirmed by reading actual CI logs, not inferred from the docs. Trust them over
`docs/BUILD-REPORT.md`, which is stale (it claims "Windows port not started" under G-release
while the Windows build demonstrably works and ships).

### F1. All 17 unit suites pass on Windows when run individually

`.github/workflows/windows.yml` ("Tests on Windows") loops over `packages/*` and `apps/*`,
running one `node --test` per package with `--test-timeout=180000 --test-force-exit`, collecting
failures and exiting non-zero at the end. On `09f73de` it printed `failed suites:` (empty).

Re-verified 2026-10-02 locally: all 17 suites pass on Windows, and the loop above is the correct
shape. The `--test-force-exit` flag was the one part of it that did not work; see F6.

### F2. The `ci.yml` Windows failure is a single missed Windows allowance

`ci.yml` runs `pnpm test` → `pnpm -r --if-present test`. On `09f73de` the Windows leg failed:

```
packages/sources-other/test/http.test.ts:151
pacing: two processes sharing the database never send to one host less than 1 second apart
  AssertionError: assert.ok(Date.now() - t0 < 200)   → actual: false
```

Critically, `pnpm -r` **aborts on first failure** (`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`), so
`sources-ats`, `resume` and `store` were killed mid-run and reported "Failed" without ever
reporting a real assertion. They are not known-broken — see F1.

The root cause is an oversight, not a product bug. The author *already* handled Windows
scheduler latency in this very test, five lines above the failure:

```ts
// http.test.ts:144-147
// The booked slots are 1100 ms apart; what is measured here is when each waiter woke, so
// event-loop latency on a busy shared runner (Windows) shows up as a shorter measured gap.
const slack = process.platform === 'win32' ? 400 : 15;
for (let i = 1; i < times.length; i++) assert.ok(times[i]! - times[i - 1]! >= MIN_GAP_MS - slack, ...);

// http.test.ts:149-151  ← the "different host is not held up" assertion, no Windows allowance
const t0 = Date.now();
await pa.wait('other.example', 0);
assert.ok(Date.now() - t0 < 200);
```

Line 151 asserts an operation completes *quickly*, so runner latency makes it read as **larger**,
not smaller — which is why the 400ms slack on line 146 doesn't help it. The fix mirrors line 146.

### F3. The installer build path is Windows-clean by design

- `apps/shell/scripts/pack.ts:76-84` auto-detects `process.platform === 'win32'` → target
  `win-x64`, and maps the ONNX runtime prune to `['win32','x64']` (macOS: `['darwin','arm64']`).
- `apps/shell/src-tauri/tauri.conf.json` already carries the Windows bundle config:
  NSIS `installMode: currentUser`, `webviewInstallMode: downloadBootstrappper`, and
  `icons/icon.ico`.
- `apps/shell/src-tauri/Cargo.toml` already has the `[target.'cfg(windows)'.dependencies]`
  block (`tauri-plugin-notification`, because Windows has no `osascript`).
- `src/lib.rs` has `cfg(windows)` branches: sidecar is `node.exe`, data folder is
  `%APPDATA%\jobleft`, quit goes through `POST /api/v1/shutdown` (no SIGTERM on Windows).

### F4. `pnpm --filter @jobleft/shell app:build` is macOS-only, despite the README

`apps/shell/package.json` defines:

```json
"app:build": "node scripts/pack.ts && CARGO_TARGET_DIR=\"$(cd ../.. && pwd)/.cache/cargo-target\" node \"...tauri.js\" build --debug --bundles app"
```

`$(cd ../.. && pwd)` is POSIX shell syntax and `--bundles app` is a macOS target. Neither
survives `cmd.exe`/PowerShell. Do **not** use this on Windows — copy the CI sequence instead
(Stage 3). The repo has `apps/shell/scripts/build-macos.sh` and no Windows equivalent.

### F5. The QA replay suite was written for macOS testers and has Windows-fragile assumptions

`windows.yml` says so itself: *"the scenario scripts the Mac testers wrote (qa/scenarios) run
on Windows"*. `qa/scenarios/README.md` requires `CHECK ok` / `CHECK FAIL` lines and a non-zero
exit, and forbids assuming any specific job exists — but several scenarios still trip over
live-crawl data.

### F6. `--test-force-exit` is unusable on Windows, and it was hiding green suites

`windows.yml` passed `--test-force-exit` so a lingering handle would fail fast. On Windows that
flag calls `exit()` while undici's keep-alive sockets are still open, and Node's libuv aborts the
whole process:

```
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94
```

The trap: **the crash says nothing about which suite or test failed.** `packages/sources-other`
passes 10/10 standalone under `--test-force-exit`, and every other suite does too — the abort is
triggered by *which* sockets happen to still be open, so it looks random in CI. Measured: the
`metered client: price cap` test crashed 3/3 under force-exit and 0/6 without it; multiple fetches
to one origin crash consistently. `Connection: close`, `closeAllConnections()`, and awaiting
`server.close()` all fail to prevent it. A 300 ms settle before teardown does, which points at
libuv's Windows timer/close path rather than the sockets themselves.

Fix shipped: drop `--test-force-exit` from `windows.yml` and add `timeout-minutes: 30` to the step
instead. A per-test hang is still caught as a *named* failure by `--test-timeout=180000`, and a
lingering-handle hang now fails the step by timeout instead of aborting the process. This matches
`ci.yml`, which never used force-exit and already relied on `timeout-minutes`.

### F7. `packages/resume/test/cli.test.ts` shelled out to a POSIX `sh`, so it failed on every ordinary Windows machine

Line 57 did `spawnSync('sh', ['-c', '"…" profile show | head -1'])`. `sh` is not on PATH on a
stock Windows install (Git Bash's `sh.exe` lives in `C:\Program Files\Git\usr\bin`, which is not
added to PATH). `spawnSync` then returns no `stderr`, so the next line —
`assert.doesNotMatch(piped.stderr, /EPIPE|at /)` — threw `The "string" argument must be of type
string. Received type undefined` and took the whole walk-through down with it.

**This is why `windows.yml` looked green while local runs were not:** GitHub's `windows-latest`
image puts Git's `bin` on PATH, so `sh` resolves there. Measured 4/4 failing locally, 0 failures
on CI. Fixed by closing the pipe from Node (`spawn`, read one chunk, `stdout.destroy()`) instead
of through a shell — same property under test, no POSIX dependency. Now 3/3.

### F8. `packages/crawler/test/e2e-hostile.test.ts` had a hardcoded 2000 ms wall-clock budget

`assert.ok(by.get(g)!.elapsedMs < 2000)` measured 2151 ms on a loaded machine (1 failure in 4
runs). Fixed to a bound derived from the crawl's own `requestTimeoutSeconds: 4`: the bad boards
each burn a full timeout, so a good board that was genuinely *held up* lands at ≥ 4 s, while one
merely sharing a busy machine lands well below. Now 8/8.

---

## Stage 1 — Run it on Windows (no Rust needed)

Goal: prove the app works on Windows before changing anything. Two independent routes.

**Route A is done** (2026-10-02), as a by-product of Stage 3: `build-windows.ps1` installs the locally built
installer silently, the app starts, answers health, reports its window and stops through the shutdown route. No Rust
knowledge was needed to run it. The `delete-all` / onboarding behaviour in Stage 4 still wants a human in the UI
though — the replay harness (Route C) proves the same surfaces headlessly, and it has not been run here.

### Route A: the released installer (zero build)

Download `jobleft_0.1.3_x64-setup.exe` from
<https://github.com/blueturboguy07/jobleft/releases/tag/v0.1.3>. Silent install:

```powershell
Start-Process -FilePath .\jobleft_0.1.3_x64-setup.exe -ArgumentList '/S' -Wait
$exe = "$env:LOCALAPPDATA\jobleft\jobleft.exe"   # NSIS installMode: currentUser
```

Data lands in `%APPDATA%\jobleft`. Run file at `%APPDATA%\jobleft\run\server.json`, logs at
`%APPDATA%\jobleft\logs\sidecar.log`. The installer is **not code-signed**, so SmartScreen will
warn; that is expected and documented in `apps/shell/README.md`.

### Route B: dev server in a browser (better for iterating on UI bugs)

```powershell
corepack enable
corepack use pnpm@12.4.1     # repo pins this; you likely have pnpm 11.x globally
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @jobleft/ui build
pnpm start
```

`--ignore-scripts` is **mandatory**, not optional: `pnpm-workspace.yaml` sets `ignoreScripts: true`
(repo "Rule 5", third-party install scripts are untrusted). `corepack use` also rewrites the
`packageManager` field — revert that if you don't want it in your diff.

`pnpm start` launches `apps/server/src/main.ts` with `JOBLEFT_HOME=<repo>/.jobleft-dev` and prints
`http://127.0.0.1:<port>/#token=<token>`. Open it in Edge. `pnpm app:down` stops it.

Useful test hooks (from `apps/shell/README.md`): `JOBLEFT_HOME`, `JOBLEFT_AUTO_CRAWL`,
`JOBLEFT_SEED_BOARDS`, `JOBLEFT_OFFLINE`. Setting `JOBLEFT_AUTO_CRAWL=0` and
`JOBLEFT_SEED_BOARDS=none` gives a quiet app for UI work.

### Route C: run the black-box QA replay locally

This is how you reproduce the Stage 4 failures without waiting on CI.

```powershell
pnpm --filter @jobleft/extension build
$env:JOBLEFT_QA_URL="http://127.0.0.1:<port>/#token=<token>"
$env:JOBLEFT_QA_API="http://127.0.0.1:<port>/api/v1"
$env:JOBLEFT_QA_TOKEN="<token>"
$env:JOBLEFT_QA_SHOTS="$PWD\qa\shots"
$env:JOBLEFT_QA_EXTENSION="$PWD\apps\extension\dist"
node qa/bin/run-all.mjs feed tracker resume network settings extension
```

The driver is headless Chrome over the DevTools protocol; set `JOBLEFT_CHROME` if Chrome isn't at
the default path. If you change `apps/ui/scripts/browser.ts` or the extension's
`scripts/cdp.ts`, rebuild the drivers (see `qa/README.md`) or your changes won't be picked up.

---

## Stage 2 — Green the `ci.yml` Windows leg

Smallest real win, and the fix is a few lines. Two changes.

### 2a. Give `http.test.ts:151` the same Windows allowance as line 146 — **done**

The suggestion below was the first attempt and was **wrong**: it used a hardcoded `1000`. Shipped
instead, and it is a better fit for how the file is already written:

```ts
assert.ok(Date.now() - t0 < MIN_GAP_MS, ...);   // was a bare 200
```

`MIN_GAP_MS` (1100) is the quantity the test already reasons about — the minimum spacing the pacer
must hold. A blocked wait would exceed it by construction, so the assertion still catches the real
regression without a second magic number. Verified the bound still discriminates: unheld host
7 ms, held host 1113 ms. Then re-ran under 36-way CPU contention: 0/25 failures.

### 2b. Stop `pnpm -r` from masking 16 suites behind 1 flake — **done, differently**

`ci.yml`'s `pnpm test` does abort the leg on the first failure, and the plan was to port
`windows.yml`'s PowerShell loop across. Not done: `windows.yml` already isolates per suite, and
`ci.yml` is now green on its own merits (2a), so the masking is no longer costing anything
observable. The invariant — **one broken suite must not silence the other sixteen** — still holds
in the workflow that does the isolating. Revisit only if `ci.yml` goes red again.

### 2c. Stop leaking the launch token into CI logs — **done**

The replay job printed the launch token 12 times. The build/smoke job printed it 0 times, because
it passes; the leak only appears when scenarios fail, which on Windows they did.

The app was never at fault: `apps/server/src/server.ts:118` already calls
`log.addSecret(opts.launchToken)`, and `apps/ui/src/app/api.ts` strips `#token=` from the URL
before any screenshot (confirmed structurally *and* by scanning the raw PNGs).

Two changes, tiers 1 and 2:

1. `::add-mask::$($j.token)` in both `windows.yml` launch steps, immediately after the token is
   read and before it is written to `$GITHUB_ENV`.
2. `qa/bin/redact.mjs`, wired into `run-all.mjs` and `wait-for-jobs.mjs`. `run-all.mjs` was the
   real vector: it `process.stdout.write`s every scenario's stdout+stderr into the workflow log
   verbatim, so anything a failing scenario printed landed in plain text. `redact()` replaces
   `#token=<value>` and any bare occurrence of `JOBLEFT_QA_TOKEN`'s value with `<REDACTED>`, and
   leaves `CHECK` lines intact.

Do **not** quote `gh run view --log` output for this job without redacting: the token is the
`x-jobleft-token` header value and grants full access to the loopback API.

### 2d. Fix the three portability bugs found while verifying 2a–2c — **done**

Not in the original plan; all three surfaced only once the suites were actually run on this
machine. See F6 (`--test-force-exit` aborting green suites), F7 (POSIX `sh` in `resume`), and F8
(a 2000 ms wall-clock budget in `crawler`).

---

## Stage 3 — Build the installer locally

**Done 2026-10-02.** Unblocked by Visual Studio Build Tools at
`C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools` with
`Microsoft.VisualStudio.Component.VC.Tools.x86.x64`. `cl.exe` is not on `PATH` and does not need to be: cargo finds
it through the usual Visual Studio detection, which is how the CI build works too. WebView2 runtime *is* present. Node
24.19.0 and Rust 1.97.1 are fine (`rust-version = "1.77"` is the floor).

The CI sequence worked on the first attempt. A cold Rust build takes **6–7 minutes**; warm, ~2. The NSIS installer is
**54.4 MB**. The smoke step from `windows.yml` then passed locally too: silent install to
`%LOCALAPPDATA%\jobleft\jobleft.exe`, health `{"app":"jobleft","version":"0.1.3","apiVersion":1,
"extensionProtocol":1}`, `run/shell.json` with `windowShown:true`, clean shutdown through the route, run file gone.

### Now one command

`apps/shell/scripts/build-windows.ps1` (new, uncommitted) does the whole thing — toolchain checks, UI, `fetch-node`,
`pack`, `tauri build --bundles nsis`, then the same smoke test as CI. `--skip-smoke` stops after the installer. It is
the Windows counterpart of `build-macos.sh`; the macOS script's signing/notarizing half has no Windows equivalent yet
(the installer is unsigned), so this script has no signing step.

Two paths matter and they differ:

| Where | Cargo target dir | Installer lands in |
| ----- | ---------------- | ------------------- |
| `windows.yml` (no `CARGO_TARGET_DIR`; `Swatinem/rust-cache` supplies one) | `apps/shell/src-tauri/target` | `apps/shell/src-tauri/target/release/bundle/nsis/` |
| `build-windows.ps1` | `$ROOT/.cache/cargo-target` (the shared folder the README mandates, git-ignored) | `.cache/cargo-target/release/bundle/nsis/` |

Two PowerShell traps hit while writing it, both worth remembering:

- **`$home` is a read-only automatic variable.** Assigning it throws `Cannot overwrite variable HOME because it is
  read-only or constant`. Use another name.
- **`Push-Location` writes to the pipeline.** `x = Push-Location $dir` makes `$x` an *array* of the pushed path plus
  whatever the block emits, and the array then silently becomes the argument list of the next native command. That is
  how `node $cli build` became `node <directory> build` and failed with `Cannot find module '...\apps\shell\build'`.

Plus one general one: **PowerShell 5.1 drops double quotes out of arguments passed to native exes.** `node -p
'process.versions.node.split(".")[0]'` reaches node as `split(.)[0]`. Single quotes survive; double quotes do not.

### The manual sequence, if you ever need it

```powershell
pnpm --filter @jobleft/ui build
node apps/shell/scripts/fetch-node.mjs --target win-x64
$env:JOBLEFT_PUBLIK_APP_TOKEN = '<your token>'   # or write apps/shell/publik-app-token.local
node apps/shell/scripts/pack.ts --target win-x64
Set-Location apps/shell
$cli = node -p "require.resolve('@tauri-apps/cli/tauri.js', { paths: ['.'] })"
node $cli build --bundles nsis
```

The build ran with an **empty** `PUBLIK_APP_TOKEN` (per the 2d/Stage 3 decision: `pack.ts` printed *"publik app token:
none (Connect to publik stays off)"*), so the shipped app starts without `JOBLEFT_PUBLIK_ALLOW_LIVE=1`. Rebuild with
the token in `apps/shell/publik-app-token.local` if the AI paths need to work.

`pnpm --filter @jobleft/shell pack` works cross-platform (plain `node scripts/pack.ts`, no shell syntax) if you just
want the sidecar tree.

---

## Stage 4 — The Windows-specific replay failures

From the `replay` job on `09f73de`. The step reported `onboarding=failure crawl=success rest=failure`
— but because those steps are `continue-on-error: true`, all three showed **green** in the job
UI while the final `Result` step failed. Always read the `Result` step, not the step colours.

**Scope decision (2026-10-02): Windows-specific failures only.** The platform-independent bugs
and the live-crawl data noise listed below are documented but explicitly out of scope for now.

### S4.1 `delete-all wipes the data folder contents` — HIGHEST SEVERITY

`qa/scenarios/settings.mjs:609`. Observed:

```
storage {"dataDir":"C:\\Users\\runneradmin\\AppData\\Roaming\\jobleft",
         "dbPath":"...\\data\\jobleft.db","dbBytes":53592064,"jobs":4302,"openJobs":4302}
profile.firstName null  resumes 0  publik disconnected  keySet false
```

Every *personal* record cleared correctly. The **job database did not**: 4302 jobs and a 53 MB
DB file survived. The README promises *"Settings → Data and backup exports or deletes all of
it."* This is a privacy-relevant correctness bug, and on Windows a likely mechanism is that the
SQLite file can't be deleted or truncated while WAL handles are open (note `http.test.ts:152`
already carries the comment *"closed before the removal: Windows cannot delete an open
database"* — the codebase knows this class of problem exists).

Investigate whether the route only clears person-scoped tables by design, or whether file-level
removal fails on Windows due to open handles.

### S4.2 `no-mac-words-on-windows:step6`

> `key on the next screen; it stays in the macOS Keychain.`

The step-6 copy still promises a macOS credential store. There is no Windows equivalent wired up
(DPAPI / Credential Manager). Either the copy must name the real Windows behaviour, or Windows
needs an actual keychain path. Note `08c0009` already fixed Mac wording across the UI and made
the key-store sentence name "the macOS Keychain **or the encrypted file by system**" — so the
Windows branch of that sentence may simply be missing. Check `apps/ui` onboarding step 6 copy
first; it may be a copy fix rather than a code fix.

### S4.3 `feed-tabs-equal-tracker` and `feed-tabs-equal-tracker-after-reload`

> `Applied tab NaN vs API 2`

The feed's Applied tab count renders `NaN` where the API says 2. A `NaN` reaching the DOM
usually means arithmetic on `undefined` — a missing/undefined field in the tab-count computation.
Checked at `qa/scenarios/tracker.mjs:178` (the check-name list) and `:558` (the skip list).

### S4.4 `companies view: Kroger count equals API coverage and match rows`

> `ui=null coverage=6 matched=6`

The API is correct (6 companies covered, 6 matched) but the UI rendered nothing. `ui=null` means
the scenario could not find the element at all — either a render crash, a selector that drifted,
or the view needs data the scenario didn't provide. Check `qa/scenarios/network.mjs:621`.
Related: the adjacent check at `:626` (companies view "Who to contact first" gives reasons) also
failed, which suggests the whole view failed to mount rather than one number being wrong.

### S4.5 `onboarding-on-first-run` + `relaunch-continues-onboarding`

> `onboarding-on-first-run: landed on #/jobs / "Jobs"`
> `relaunch-continues-onboarding: after quitting on step 2 the app opened #/jobs; steps 2-6 are skipped`

Both at `qa/scenarios/onboarding.mjs:444` (the second) — likely one shared root cause.

Strong hint from the same log: the onboarding step ran with `JOBLEFT_QA_STATE=fresh`, yet two of
its own checks printed

```
CHECK skip empty-feed-is-honest: 4302 jobs already stored
CHECK skip first-refresh-finishes: jobs already stored
```

So **4302 jobs were already crawled during the "fresh" first-run phase**. Auto-crawl appears not
to be gated on onboarding completing, which would both populate the store early and let the app
land on `#/jobs` instead of the onboarding route. Verify the ordering in
`apps/server` (crawl scheduler vs. onboarding-complete flag) before touching the UI.

### Documented but out of scope

Real bugs, not Windows-specific — fix only if scope is widened:

| Check | Symptom |
| ----- | ------- |
| `api-refuses-unknown-country` | `status 200 (country "XX" accepted)` — API accepts an invalid country |
| `counts: Applied badge equals saved applied jobs` | `badge undefined vs 0` |
| `like: the Liked badge goes up at once` | `request sent: false; badge did not reach 1 in 5 s` |
| `Resume screens and Settings — Balance show no banned words` | `balance: $0 found` (possibly the missing `PUBLIK_APP_TOKEN`; see gotchas) |
| `UI: first cards within 2 s` | `2878 ms` — perf, likely runner noise |

Live-crawl data noise — the scenarios need hardening, not app fixes:

| Check | Symptom |
| ----- | ------- |
| `no-banned-words:jobs-empty` / `banned-words: job detail` / `unknown-job-page` | Real crawled posting contains the garbage string `"credit: .or likely Full Stack Software Engineer, Credit Cards & Banking Robinhood / Money."` |
| `filter exact: country CA` | `1/78 jobs break the filter` |
| `job_a_missing_stay_empty` | practice-server scenario |

---

## Stage 6 — Windows ACL for `run/server.json`

**Not started.** Kept deliberately separate from the token-leak work in 2c, which is about *logs*;
this is about *the file on disk*.

On macOS, `apps/server/src/home.ts` creates the data folder `0o700` and `run/server.json` with
owner-only permissions, which is what stops another local user reading the launch token. Windows
skips that path, so the file inherits whatever the parent folder allows — normally readable by
every user on the machine. The token in it is the same one as in 2c: full access to the loopback
API for as long as the app runs.

Fixing it means an ACL call (`icacls` or a Win32 equivalent) rather than a `chmod`, so it is a
new code path, not a port of the existing one. Decide whether it belongs in the app or in the
installer before starting; that choice is the whole stage.

---

## Gotchas

**`PUBLIK_APP_TOKEN` does not exist in a fork.** GitHub does not pass secrets to forked repos, so
`windows.yml`'s `Sidecar tree` step gets an empty `JOBLEFT_PUBLIK_APP_TOKEN`. `pack.ts` then
writes an empty `publik-app-token.txt`, and per `apps/shell/README.md` the app starts *without*
`JOBLEFT_PUBLIK_ALLOW_LIVE=1` — "Connect to publik" is refused in plain words. Set the repo
secret on `skibkitty/jobleft` if you need AI paths, or accept that they're disabled. This is
probably also the real cause of the `balance: $0` check.

**pnpm version mismatch.** The repo pins `pnpm@12.4.1` via `packageManager`. Use `corepack use`.
Note that `pnpm-workspace.yaml` sets `engineStrict: true` and `saveExact: true`.

**CI's pnpm setup is deliberate.** Both workflows install pnpm via `npm install -g pnpm@12.4.1`
in a `bash` step, with a comment that `pnpm/action-setup`'s shim was *"a silent no-op on
windows-latest (pnpm printed nothing, installed nothing, and every pnpm step 'passed' in
seconds)"*. Don't "helpfully" swap it for `pnpm/action-setup`.

**No pnpm cache on Windows.** Both workflows pass `package-manager-cache: false` to
`actions/setup-node`; setup-node's cache step fails on Windows with the pnpm shim path.

**`windows.yml` deliberately runs tests even when they fail.** The test step is
`continue-on-error: true` and the verdict is delivered by a final `Test result` step, so the
installer, smoke test and release attach never wait on a flaky suite. Don't reorder those.

**`--ignore-scripts` everywhere.** Any `pnpm install` must pass it (repo Rule 5). The one
exception is if you deliberately allow a specific package's build script via `allowBuilds`.

---

## Resuming this work

1. Read this file, then `docs/agents/domain.md` for the codebase's vocabulary and which docs to
   trust (`docs/INTERFACES.md` §5.1–5.2 for the server and shell contracts; `apps/shell/README.md`
   for the authoritative Windows notes).
2. Check `git log --oneline origin/main..HEAD` — is there work in flight?
3. Pick the first stage with status `not started`. That is **Stage 4** now: Stages 1 (Route A), 2, 2c and 3 all landed
   2026-10-02. Route C of Stage 1 and Stage 6 are still open and smaller than Stage 4.
4. Use the `diagnosing-bugs` skill for the Stage 4 items (see below). Update the **Stage status**
   table at the top when a stage lands.

### Which skills to use

| Skill | Use it for | Skip it for |
| ----- | ---------- | ----------- |
| `diagnosing-bugs` | **All of Stage 4.** Each is a "report says X, code says Y" investigation with a wide hypothesis space — open file handles, missing fields, render crashes, scheduler ordering. | Stage 2 (the fix is known and 3 lines wide) |
| `code-review` | Reviewing your own Stage 2 / Stage 4 diff before pushing, and especially before any upstream PR — it checks the change against the repo's own standards. | Nothing here; it's cheap |
| `to-tickets` | Turning the Stage 4 inventory into the 5 suggested issues in one pass. | If you'd rather just write the 5 issues by hand — the split is already drafted below |
| `codebase-design`, `domain-modeling` | Nothing yet. | These are for shaping interfaces and writing `CONTEXT.md`. The domain docs deliberately don't exist yet and are created lazily. Don't create them just to tick a box. |
| `wayfinder` | Nothing. | Stage 4 is five findings, not a multi-session program. Overkill. |
| `tdd` | Writing the regression test *for* a Stage 4 fix, once you know the cause. | — |

`diagnosing-bugs` is the one that matters, and this repo is unusually well-suited to it: its
Phase 1 is "build a tight pass/fail feedback loop", and **this repo already has one**. The replay
harness (`qa/bin/run-all.mjs` plus the scenario contract in `qa/scenarios/README.md`) is a
headless-Chrome pass/fail signal for exactly the surfaces Stage 4 breaks. So Phase 1 mostly means
"run the existing scenario against a scratch `JOBLEFT_HOME`", not "invent a harness".

For the non-deterministic ones (S4.5 onboarding, which depends on crawl timing) the skill's advice
applies directly: don't chase a clean repro, raise the reproduction rate until it's debuggable.

### Redact tokens when quoting logs

The `diagnosing-bugs` skill's Redact phase is not optional here, because this repo's CI logs
**used to** print secrets in plain text. `windows.yml` writes `JOBLEFT_QA_TOKEN` to `$GITHUB_ENV`,
and `run-all.mjs` echoed every scenario's stdout+stderr into the log — so `gh run view --log`
output contained a live launch token. Both are fixed as of 2026-10-02 (2c: `::add-mask::` plus
`qa/bin/redact.mjs`), so new runs should be clean. **Runs from before that date are not**: treat
any log produced before the fix as still containing a live token. `run/server.json` still contains
the launch token in plain text (that is Stage 6).

Before pasting any log, `run/server.json`, or sidecar output into an issue, a commit, or a chat:

- Replace the launch token with `<REDACTED>`. It is the `x-jobleft-token` header value and grants
  full access to the loopback API for that instance.
- Never paste `publik-app-token.local` or `JOBLEFT_PUBLIK_APP_TOKEN` at all.
- Prefer driving the loop off env vars (as the skill says) so the credential never enters the
  transcript.

A token from a finished CI run on a public runner is low-risk, but the habit matters: the same
command against a local run protects your real profile, resumes and connections.

### Suggested issue split for Stage 4

One issue per finding, so each can be reviewed and landed independently — `delete-all` (S4.1)
especially wants to be reviewed on its own. Suggested titles:

- `Windows: Settings → Delete all leaves 4302 jobs and a 53 MB database behind`
- `Windows: onboarding step 6 copy still promises the macOS Keychain`
- `Applied tab count renders NaN where the API reports 2`
- `Companies view does not mount (ui=null with 6 companies covered)`
- `First run crawls ~4300 jobs before onboarding completes, then lands on #/jobs`

### Working relationship with upstream

Undecided as of 2026-10-02. Until it is decided:

- Keep every fix on a branch **in this fork**. Do not open PRs against `blueturboguy07`.
- `git fetch upstream` occasionally; upstream was last active 2026-09-28.
- If PRs are later wanted, the natural split is: Stage 2 alone (test hardening, uncontroversial),
  then Stage 4 one check per PR. The upstream author's commit style is a detailed subject line
  stating the behaviour and its evidence (e.g. *"lock on Windows: a live holder is one that
  wrote its run file"*) — match it, since they will read diffs against that convention.
