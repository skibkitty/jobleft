# AGENTS.md

Instructions for AI agents working in this repo.

## Start here

**This is a fork of `blueturboguy07/jobleft` doing Windows work.** Read
[`docs/WINDOWS-PORT-PLAN.md`](docs/WINDOWS-PORT-PLAN.md) before doing anything else. It records
what already works, what is broken, the stage-by-stage plan, and the full inventory of known
failures with evidence. Do not re-derive any of it.

The short version: **the Windows build already works and ships.** Stages 1 (Route A), 2, 2c and 3
are done and uncommitted — the `ci.yml` Windows leg's flaky timing assertion is fixed,
`--test-force-exit` was removed from `windows.yml` (it aborts green suites on Windows), two more
Windows-only test bugs were fixed, the launch-token leak into CI logs is closed, and the installer
now builds locally with `apps/shell/scripts/build-windows.ps1` and passes the same smoke test CI runs.
Still open: `windows.yml`'s `replay` job (~5 Windows-specific checks), the local replay run, and the
`run/server.json` ACL. Start at the first stage marked `not started` in the plan's Stage status table.

## Agent skills

### Issue tracker

GitHub Issues on this fork (`skibkitty/jobleft`), via `gh`. Upstream is read-only. See
`docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, defaults kept: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context (`CONTEXT-MAP.md` + per-package `CONTEXT.md` + `docs/adr/`), not yet created. The
repo's real vocabulary docs are `docs/INTERFACES.md`, `apps/shell/README.md` and
`qa/scenarios/README.md`. See `docs/agents/domain.md`.

## Repo rules that are easy to break

- **`pnpm install` must pass `--frozen-lockfile --ignore-scripts`.** Not optional. `pnpm-workspace.yaml`
  sets `ignoreScripts: true` (Rule 5: third-party install scripts are untrusted). To allow one,
  read it first, add the package to `allowBuilds`, and record it in `THIRD_PARTY_NOTICES.md`.
- **Do not use `pnpm --filter @jobleft/shell app:build` on Windows.** It is macOS-only: it uses
  `CARGO_TARGET_DIR="$(cd ../.. && pwd)/…"` POSIX syntax and `--bundles app`. Use
  `apps/shell/scripts/build-windows.ps1` (`--skip-smoke` to stop after the installer).
- **pnpm is pinned to 12.4.1** via `packageManager`. Use `corepack use pnpm@12.4.1`.
- **Don't trust `docs/BUILD-REPORT.md`.** It is stale — it claims "Windows port not started" while
  the Windows build works and ships an installer. `apps/shell/README.md` is the authoritative
  Windows/macOS shell documentation.
- **Types that cross a package boundary live in `@jobleft/contracts`, and contracts change by
  addition only.**
- **Windows cannot delete an open SQLite database.** Several places already close the handle
  before removing the file (see the comment at `packages/sources-other/test/http.test.ts:152`).
  Watch for this in any new file-level cleanup — it is a live source of Windows-only bugs here.
- **No personal data anywhere.** Tests use the fake persona "Jordan Testwell"
  (jordan.testwell@example.com).
- **`gh` needs `--repo skibkitty/jobleft` explicitly** for issue and label commands, since this
  clone has two remotes.
- **CI reads as green when it is not.** In `.github/workflows/windows.yml` the test and replay
  steps are `continue-on-error: true` and the verdict arrives in a final `Result` step. Read the
  `Result` step output, not the step colours in the GitHub UI.
- **The replay job's red is usually a *new* failure, not the old ones.** `qa/bin/run-all.mjs`
  fails closed: it tolerates a failed check only when `scenario` + `name` match an entry in
  `qa/known-failures.json`, and a scenario that crashes, times out, exits oddly or leaves a result
  that does not add up fails the run outright. So a red `replay` means read the
  `== NOT in qa/known-failures.json` block — that block is the regression. The
  `== known failures tolerated` block is expected. An `== stale baseline entries` block is only
  advice: it never fails a run, so fix the bug and delete the entry in a follow-up. Check names in
  that file were read from **source**, not from log lines — a log cannot show where a name ends when
  the name contains `": "`. See `qa/scenarios/README.md`.
- **Redact the launch token before quoting any log.** `gh run view --log` prints
  `JOBLEFT_QA_TOKEN` in plain text. It is the `x-jobleft-token` header value and grants full access
  to the loopback API. Write `<REDACTED>` in its place, in issues and commits as well as chat.
- **Never rewrite a scenario file with PowerShell 5.1 `Set-Content`/`Out-File`.** They default to
  the ANSI code page, which silently mangles the non-ASCII in check names (`→`, `…`) that
  `qa/known-failures.json` matches on. Use the editor tools, or `node`/`-Encoding utf8`, and check
  `git diff --stat` shows only the lines you meant to touch.

## Vocabulary

Do not paraphrase this codebase's terms: **feed**, **match band**, **board**, **source**,
**posting**, **credit**, **open job**, **sidecar**, **shell**, **lane**, **gate**, **replay
scenario**, **check**. Definitions and the traps are in `docs/agents/domain.md`.
