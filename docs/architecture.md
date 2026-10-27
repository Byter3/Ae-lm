# Client architecture

Ae-lm is the After Effects client for the [studio assistant backend](https://github.com/Byter3/studio-assistant-backend). [Hou-lm](https://github.com/Byter3/Hou-lm) supplies the Houdini integration. The clients share model routing, not project state or execution permissions.

## Host integration

The CEP panel uses embedded Node/Chromium. `evalScript` sends JSON envelopes to `AELM.dispatch` in the ExtendScript bridge. No MCP process or workstation HTTP listener is required. Keep host JSX compatible with ExtendScript, separately from AE's expression engine.

## Data flow

1. `/api/models` lists permitted models; `/api/chat/completions` receives bounded context and tool definitions.
2. Complete tool batches are validated before dispatch. Host calls are serialized.
3. `ae_inspect` reads authored state and existing diagnostics. `ae_run_script` executes the exact locally approved proposal, consuming its execution ID first.
4. Source, results and outcomes become receipts and local history. Subsequent model steps use those results without replaying commands.

Known `script_failed` results cancel the remaining batch and require a fresh successful inspection before a new repair proposal. Unknown outcomes, project changes and persistent history-save failures stop execution. Partial output is explicitly labelled; omitted values remain unknown.

The host execution ledger survives panel reloads. Restart AE after updating host JSX.

## Storage and connection

Full archives use `.aelm/<project filename>.json`, with adjacent content-addressed image assets. Save As carries history forward. Atomic saves detect conflicting writers and retry transient sharing errors within bounded limits. Permanent failures stop further commands.

Model context is independent of the archive: exact recent call/result pairs remain while they fit; older content and bulky successful results can become marked excerpts. Image requests add active references and the current turn's latest capture after text fitting.

Local preferences hold URL, model and visual-check budget. Tokens stay in memory, with optional read-only reuse of Hou-lm's matching Windows login. Auto-run and capture authorization are session-local. TLS is validated and redirects are rejected.

See [behavior contract](assistant-conventions.md), [visual workflow](visual-workflow.md) and [compatibility](validation.md).
