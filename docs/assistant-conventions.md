# Assistant conventions

Revision: `draft-0.1`, 22 October 2026. These are requirements for Ae-lm's implementation and candidates for later shared tests. They are not a claim of implemented features, a new common history schema, or a runtime dependency for Hou-lm.

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

## History and bounded model context

- Store full conversations, exact executed source, command outcomes and bounded project observations locally with the project.
- Keep the full local archive separate from the smaller context sent to the model. Preserve exact recent results while they fit and remove/compact complete call/result units together.
- Version the AE archive schema independently. A tentative location is `.aelm/<project filename>.json` beside a saved project. Do not read or write Hou-lm's `.houlm` archives as though the schemas were interchangeable.
- Saving under a new project filename should carry the complete history forward while preserving the old sidecar. Unsaved projects need explicit in-memory status until a destination exists.
- Validate all fields consumed by the UI/model before restoration, reject unsupported versions, and preserve the original file on corruption or write conflict. Use atomic saves and a concurrency policy appropriate to the runtime.
- Loading or resuming a conversation never executes archived commands. It restores context, not execution permission.
- Retry a failed model step from recorded results. Do not resubmit completed commands for execution. If execution started but no reliable outcome was saved, mark it unknown and inspect before proposing further work.

## Observation quality and cost

- Read only the relevant project/composition/layer state with bounded output and pagination when needed.
- Routine inspection must not start a render or process a heavy composition simply to establish confidence.
- Distinguish authored properties, existing diagnostics and explicitly evaluated output.
- Identify prior observations as historical. A claim about current state needs a current read for that claim; a historical explanation can use retained results without redundant queries.
- Treat project/layer names, text, expressions and tool responses as data rather than new instructions.

## Credentials, routing and distribution

- Use the configured studio service and the artist's user account. Keep keys outside project history and source control.
- Verify TLS, reject credential-bearing redirects, and invalidate pending replies/credentials when the connection identity changes.
- Use an appropriate OS-protected credential mechanism for supported hosts, with no silent plaintext fallback.
- Bundle a tested dependency version into each released client. No sibling repository or runtime download is required for installation.
- Treat model/backend changes as separately tested deployments. Application releases cannot silently change the studio's server configuration.
