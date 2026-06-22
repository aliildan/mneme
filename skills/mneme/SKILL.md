---
name: mneme
description: Use when finding or understanding code in this repo, recalling past decisions/gotchas/conventions, or after making a notable decision — route the work through mneme's index and memory instead of blind grep.
---

# Using mneme in this project

This project is indexed by **mneme** (MCP tools, kept auto-fresh). Prefer it over blind exploration:

- **Locating code** — before `grep`/`glob` to find where functionality lives or how something works, call `mneme_get_context` with the task in your own words. It returns ranked symbols + minimal snippets within a token budget.
- **Reusing past work** — before re-deriving a decision, convention, or fix, call `mneme_recall_memory` (search by text / kind / files).
- **Persisting decisions** — when you make a notable decision, hit a gotcha, or learn something durable about this repo, call `mneme_record_memory` (kind: `decision` | `gotcha` | `learning` | `todo`, body verbatim) so it's available in future sessions.

Plain `grep`/`read` are still fine for quick, known-path lookups. Reach for mneme when the question is "where/how does X work here?" or "did we already decide/learn this?".
