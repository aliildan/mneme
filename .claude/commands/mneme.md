---
description: Pick the Mneme discovery model for candidate narrowing
allowed-tools: ["mcp__mneme__mneme_list_models", "mcp__mneme__mneme_set_discovery_model"]
---

Call `mneme_list_models` with `refresh: true`. Print the returned options as a numbered list. For Anthropic entries, include the cost warning. Wait for the user to reply with a number (0 = none/deterministic only).

Once the user replies, call `mneme_set_discovery_model` with the chosen `id` from the options list (or `null` for option 0).

Confirm the selection was saved.
