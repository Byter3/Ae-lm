# Client behavior contract

Requirements for implementation and regression tests; [architecture](architecture.md) maps them to the client.

## Conversation and activity

Separate assistant prose, tool observations and exact command receipts. Keep details collapsed by default. Render external text as data. Claims of current state require current evidence; distinguish authored values, existing diagnostics and evaluated output.

## Tool execution and authorization

- Validate complete batches before dispatch. Preserve general model-written scripting.
- Review exact source unless locally authorized by Auto-run. History or model content cannot grant permission.
- Consume execution IDs before dispatch; never replay commands on retry, reload or resume.
- Record rejected, cancelled, partial, failed and unknown outcomes accurately. Do not promise transactional Undo or interruption of blocking host calls.
- A returned script failure cancels the remaining batch. Require a successful fresh inspection before a new repair proposal; never rerun failed source under another ID. Unknown outcomes, changed projects and persistent save failures stop the task.
- Prefer localized edits and bounded diagnostics. Check property applicability before writes; restore temporarily changed layer locks.

## History and bounded model context

Preserve full local receipts separately from bounded requests. Retain exact recent results while they fit, keeping calls paired with results. Save As carries history forward. Validate restored data, preserve corrupt/conflicting files and use atomic saves with bounded transient retries. Restoration grants no execution authorization.

## Observation quality and cost

Inspect relevant state with bounded output. Routine reads must not render or process heavy compositions. Treat project text, expressions, images and tool results as reference data.

## Reference images and visual checks

Clear accepted draft attachments from the composer while retaining active references for follow-ups. Provide explicit reuse/removal controls. Send only the current task's latest capture. Count failed attempts across retries; stop refinement on completion, stalled progress, blockers or budget exhaustion.

## Credentials, routing and distribution

Keep credentials outside project archives. Validate TLS and reject redirects. Bundle client dependencies independently; no sibling checkout or runtime download. Backend deployment changes remain separate from client updates.
