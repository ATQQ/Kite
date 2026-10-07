<!-- kite-workspace:start -->
## Kite Workspace Agent Workflow

When this repository is part of a Kite Workspace, use the Kite CLI as the source of truth for requirements, tasks and documents.

- Start work with `kite task inbox --agent <cursor|claude|codex|workbuddy|trae> --json`.
- Claim only an assigned task or an unassigned task in the inbox with `kite task claim <taskId> --agent <cursor|claude|codex|workbuddy|trae>`.
- Report meaningful progress with `kite task update <taskId> --agent <cursor|claude|codex|workbuddy|trae> --status <status> --summary "<what changed>"`.
- Put durable process knowledge in `kite doc push <file> --agent <cursor|claude|codex|workbuddy|trae> --title "<title>" --kind <spec|design|handoff|report|note>` and link it to the active requirement or task.
- Before editing an existing document, run `kite doc pull <docId> --agent <cursor|claude|codex|workbuddy|trae>`; never overwrite a revision conflict.
- Do not write tokens into repository files. Tokens live in `~/.kite/config.json`.
- Do not manage workspace membership, rotate tokens, delete requirements, or reassign another agent's task.
<!-- kite-workspace:end -->
