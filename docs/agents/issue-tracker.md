# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues **on the fork**, not upstream. Use the `gh` CLI for all operations.

- **Tracker repo**: `skibkitty/jobleft` (this fork). Upstream is `blueturboguy07/jobleft` and is read-only for us.
- Because `git remote -v` has two remotes, pass `--repo skibkitty/jobleft` explicitly on every `gh issue` / `gh label` call. Bare `gh issue` commands resolve against `origin`, which happens to be the fork today, but do not rely on that.

## Conventions

- **Create an issue**: `gh issue create --repo skibkitty/jobleft --title "..." --body "..."`.
- **Read an issue**: `gh issue view <number> --repo skibkitty/jobleft --comments`.
- **List issues**: `gh issue list --repo skibkitty/jobleft --state open --json number,title,body,labels --jq '[.[] | {number, title, labels: [.labels[].name]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --repo skibkitty/jobleft --body "..."`.
- **Apply / remove labels**: `gh issue edit <number> --repo skibkitty/jobleft --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --repo skibkitty/jobleft --comment "..."`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue on `skibkitty/jobleft`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --repo skibkitty/jobleft --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --repo skibkitty/jobleft --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**. Add an edge with `gh api --method POST repos/skibkitty/jobleft/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/skibkitty/jobleft/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open --repo skibkitty/jobleft`), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --repo skibkitty/jobleft --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n> --repo skibkitty/jobleft`, then append a context pointer to the map's Decisions-so-far.
