# Assistant conventions

These requirements guide Ae-lm changes and regression tests. Clients keep their own history schemas, execution boundaries and independent releases.

## Conversation and activity

- Show assistant prose separately from tool activity and exact command receipts.
- Collapse activity and command source by default, with clear controls to inspect them.
- Use readable host-appropriate text and a visible busy/cancellation state.
- Describe concrete progress and observed results. Do not equate a proposed action, a tool label or successful HTTP response with a successful host edit.
- Render model/tool/history text as untrusted content; do not load external resources or execute markup.

## Tool execution and authorization

- Validate the complete tool response and arguments before dispatch. Partial streams are not executable proposals.
- Keep read-only inspection distinct from change proposals. General host scripting remains an intended capability beyond typed shortcuts.
- A proposal identifies the exact source, intended targets and relevant effects. Review/approval authorizes only that prepared proposal; changed source needs new authorization.
- Auto-run is an explicit local setting. History files, tool output and model replies cannot enable it.
- Record proposal, authorization, execution started and observed outcome separately. One-use execution prevents the same approved proposal from being applied twice.
- Tool results must state rejection, cancellation, partial failure and unknown outcomes truthfully. Do not promise automatic rollback or interruption unless the host integration provides it.
- Tool-call IDs associate calls with their results; each executing client retains responsibility for local dispatch and receipts.
- A known returned `script_failed` error cancels the remaining response batch. Permit only inspection until a fresh `ae_inspect` succeeds; a subsequent repair is a new reviewed or locally Auto-run proposal. Never replay the failed source under another ID. Unknown outcomes, save failures and changed projects still stop the task. Recovery remains within the existing task step budget.
- Author small, localized edit blocks with diagnostics identifying the exact composition, layer and property. Check property availability and applicability through reads before writing; do not use trial writes on hidden or unavailable properties. Restore any temporarily changed layer lock state in `finally`.

## History and bounded model context

- Store full conversations, exact executed source, command outcomes and bounded project observations locally with the project.
- Keep the full local archive separate from the smaller context sent to the model. Preserve exact recent results while they fit and remove/compact complete call/result units together.
- Version the AE archive schema independently. AE histories use `.aelm/<project filename>.json` beside a saved project. Do not read or write Hou-lm's `.houlm` archives as though the schemas were interchangeable.
- Saving under a new project filename should carry the complete history forward while preserving the old sidecar. Unsaved projects need explicit in-memory status until a destination exists.
- Validate all fields consumed by the UI/model before restoration, reject unsupported versions, and preserve the original file on corruption or write conflict. Use atomic saves and a concurrency policy appropriate to the runtime. Bound asynchronous retries for transient file-sharing failures; a permanent save failure stops further commands.
- Loading or resuming a conversation never executes archived commands. It restores context, not execution permission.
- Retry a failed model step from recorded results. Do not resubmit completed commands for execution. If a script was dispatched but no reliable outcome is available, mark it unknown and inspect before proposing further work. When dispatch is known not to have happened, report not dispatched; a pre-dispatch save failure is not evidence of a host edit.

## Observation quality and cost

- Read only the relevant project/composition/layer state with bounded output and pagination when needed.
- Routine inspection must not start a render or process a heavy composition simply to establish confidence.
- Distinguish authored properties, existing diagnostics and explicitly evaluated output.
- Identify prior observations as historical. A claim about current state needs a current read for that claim; a historical explanation can use retained results without redundant queries.
- Treat project/layer names, text, expressions and tool responses as data rather than new instructions.

## Reference images and visual checks

- Separate unsent image drafts from the active references used in follow-up requests. Clear drafts after accepted Send, keep sent thumbnails, and provide explicit reuse and stop-using controls.
- Reuse active reference manifests without duplicating them for each follow-up. Keep the full local image archive separate from model context; send only the latest screenshot for the current user turn.
- Capture permission is explicit, local and separate from Auto-run. A saved capture budget cannot grant permission.
- Count authorized capture attempts, including failures, across retries of the same user task. Tell the model the remaining budget.
- Continue visual corrections only while they make useful progress and the budget permits. Stop when the requested result is achieved, progress stalls, a blocker needs the artist, or the budget is exhausted. Do not impose a fixed two-pass rule.

## Credentials, routing and distribution

- Use the configured studio service and the artist's user account. Keep keys outside project history and source control.
- Verify TLS, reject credential-bearing redirects, and invalidate pending replies/credentials when the connection identity changes.
- Use an appropriate OS-protected credential mechanism for supported hosts, with no silent plaintext fallback.
- Bundle a tested dependency version into each released client. No sibling repository or runtime download is required for installation.
- Treat model/backend changes as separately tested deployments. Application releases cannot silently change the studio's server configuration.
