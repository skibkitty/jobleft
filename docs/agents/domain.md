# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root: this is a **multi-context** repo, so the map points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. Also check `<package>/docs/adr/` for context-scoped decisions.

Neither file exists yet. **Proceed silently** — don't flag their absence, don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## Layout: multi-context

This repo is a pnpm workspace with 13 `packages/*` and 4 `apps/*`, so the eventual shape is:

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
├── packages/<name>/CONTEXT.md         ← per-package context
└── apps/<name>/CONTEXT.md
```

## Existing domain documentation (read these instead)

This repo predates the `CONTEXT.md` convention and carries its own vocabulary docs. Read them before inventing terminology:

| File | What it holds |
| ---- | ------------- |
| `docs/INTERFACES.md` | The local HTTP API contract. Section 5.1 is the dev server, 5.2 is the desktop shell contract. **Read this before changing anything in `apps/server` or `apps/shell`.** |
| `docs/GOAL.md` | What the product is for. |
| `docs/PLAN.md` | The build plan. |
| `docs/BUILD-REPORT.md` | What is built and what is not. **Caution: stale.** It claims "Windows port not started" while the Windows build demonstrably works and ships a signed-off installer. Trust `apps/shell/README.md` over this file. |
| `docs/PAUSE-STATE.md` | Where the original build workflow was paused (2026-09-25). |
| `apps/shell/README.md` | The authoritative Windows/macOS shell documentation, including the `cfg(windows)` differences. |
| `docs/INTERFACES.md`, `qa/README.md`, `qa/scenarios/README.md` | The black-box QA harness contract. |

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as the existing docs define it. This codebase has a distinctive vocabulary that must not be paraphrased: **feed**, **match band**, **board**, **source**, **posting**, **credit**, **open job**, **sidecar**, **shell**, **lane**, **gate**, **replay scenario**, **check**.

Some terms are load-bearing and easy to get wrong:

- A **posting** is one employer's listing. A **job** is the deduplicated entity across postings. A **credit** is the link from a job back to the posting that vouches for it.
- A **board** is an employer's careers site; a **source** is a configured feed from one board.
- The **shell** is the Tauri desktop app; the **sidecar** is the Node server process it launches.
- A **gate** is a build milestone the original author used (G-release, G-publik, …). A **lane** is one parallel build stream.

If a concept you need isn't defined anywhere, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
