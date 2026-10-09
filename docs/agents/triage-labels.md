# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker (`skibkitty/jobleft`).

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

All five exist as real labels on `skibkitty/jobleft` (created 2026-10-02). `wontfix` was inherited from the upstream default label set and was re-described to match the canonical meaning.

Note that `skibkitty/jobleft` also inherits upstream's default labels (`bug`, `enhancement`, `documentation`, `question`, `help wanted`, `good first issue`, `duplicate`, `invalid`, `accessibility`). Those are GitHub defaults, not part of the triage vocabulary — use the five above for triage roles.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.
