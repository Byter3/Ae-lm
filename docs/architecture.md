# Architecture

Ae-lm `0.1.0-dev.1` is an unsigned Windows CEP client.

## Application boundaries

| Component | Ownership |
| --- | --- |
| [Hou-lm](https://github.com/Byter3/Hou-lm) | Houdini panel, HOM/Python tools, HIP history and packaging |
| Ae-lm | AE panel, composition/layer/property inspection, ExtendScript execution, project history and packaging |
| [studio-assistant-backend](https://github.com/Byter3/studio-assistant-backend) | Open WebUI/LiteLLM server examples, optional gateway adapter and backend tests |

Clients use the same studio service but execute commands only in their own application. They do not share approval state or project histories. Releases are independent; no sibling checkout, shared executable client library, runtime download or artist package manager is required.

[Assistant conventions](assistant-conventions.md) define the client behavior requirements. Houdini-specific source is not imported into AE.

## Host integration

The preview uses a dockable **CEP panel**, a CommonJS client running in CEP's embedded Node environment, and a small **ExtendScript** host bridge. CEP's `evalScript` interface dispatches a JSON-encoded method and argument envelope to `AELM.dispatch`. The execution source is data inside that envelope; only the explicit execution method evaluates it.

Adobe documents panel docking, embedded runtimes and host scripting in the [CEP cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md). The manifest permits AE 24.x/25.x and experimental AE 26.x testing. The artist confirmed panel loading and a live model/inspection exchange, but the successful host build was not recorded. Separate native fixture evidence covers **AE 25.1x68 on Windows**. Neither establishes acceptance of the whole declared range; see [validation](validation.md).

Keep panel integration, host dispatch and agent logic separated so a future host adapter does not require rewriting execution/history rules.

MCP is not required between this embedded panel and AE. No workstation HTTP listener or external MCP process is started. A future MCP adapter must reuse the same local review and execution boundary rather than add an unchecked command path.

## Data flow

1. The panel sends bounded conversation context and AE tool definitions to Open WebUI's `/api/chat/completions`; `/api/models` supplies the model list.
2. The complete response is parsed and every tool request validated before any request from that response is dispatched.
3. `ae_inspect` reads bounded authored project/composition/layer/property state and existing diagnostics. It does not request a preview or render.
4. `ae_run_script` proposes general ExtendScript. Local review or explicit Auto-run authorizes the exact proposal; the host checks project identity and consumes its execution ID before running it.
5. The result and exact source enter the receipt and archive. A subsequent model request uses recorded results; retry and restore do not redispatch old commands.

Host calls are serialized. AE executes ExtendScript on its main thread, so cancelling an HTTP request does not prove a dispatched script stopped. The bridge records unknown outcomes and blocks further calls until the artist can inspect AE. Errors may leave partial changes; named Undo groups are not transactions or a security sandbox.

Successful host output that exceeds the reply limit is returned as an explicitly partial capture, preserving the completed execution ID and outcome. `_aelmHost.partial` and the receipt's **partial output** label identify this case. Omitted output was never captured by the panel and is not available in the archive; a smaller targeted inspection can obtain missing values without repeating an edit. This differs from request-context reduction, where full captured receipts remain locally available.

A returned `script_failed` error retains its details and cancels all remaining calls from that response batch. It then permits inspection-only recovery: a fresh, successful `ae_inspect` is required before the assistant can propose a new repair script. The failed source is never replayed, even under a new call ID. A repair uses a new proposal and the ordinary local review or currently enabled Auto-run permission. Unknown execution outcomes, history-save failures and project changes still stop the task; they do not enter this repair path. Recovery consumes the existing task step budget rather than starting a new unbounded loop.

The model is instructed to keep edit blocks small and localized, report the exact composition/layer/property involved in an error, and inspect property availability and applicability before writing. Hidden or unavailable properties are not probed by trial writes. If an authorized edit temporarily unlocks a layer, its original lock state must be restored in `finally`. Readback and error diagnostics remain bounded; recovery does not authorize rendering or broad scene dumps.

Project identity is read through a fresh, single-read native Project/File snapshot with one bounded recovery attempt. Persistent invalid handles return `project_unavailable`, never an invented unsaved project or a reset execution ledger.

The host bridge is retained inside AE so panel reloads do not reset consumed command IDs. After updating `extension/host/aelm.jsx`, save work and restart AE normally to load the new host implementation. Reopening only the panel is insufficient for a host-code update.

## Storage and connection

The optional [visual workflow](visual-workflow.md) adds separately stored reference/capture images and a session-only `ae_capture_view` permission. Image content is inserted into a request copy after the unchanged text context builder; text-only requests keep their existing format. The capture adapter uses a fixed bundled Windows helper through a hidden child process. It never calls an AE frame-export/render API. Selection, permission and native HWND state are never restored from history. Composer attachments are drafts: an accepted user message archives them and clears the composer. The active reference IDs then carry into follow-ups without duplicate archive entries. A sent-message action clears those active IDs without deleting the archived images. Only the latest capture in the current user turn is injected into model context. Schema 2 archives describe content-addressed image assets; schema 1 text archives remain supported.

The artist's local visual-check budget defaults to 12 attempts per user turn and accepts 1–50. It is a preference, not capture authorization. Authorized failed attempts count, and model retry keeps the same attempt count. The model receives the current budget and remaining count and is instructed to stop when the result is achieved, progress stalls, a blocker needs the artist, or the budget is exhausted; there is no fixed two-pass correction limit.

The full versioned archive is `.aelm/<project filename>.json` beside saved `.aep`/`.aepx` files; unsaved projects remain in memory. Save As carries the archive to a new destination while preserving the original. Existing destination histories, malformed files, locks and concurrent changes fail without silent replacement. Atomic writes use an exclusive lock and baseline-content check. The controller awaits each save before proceeding. Temporary rename errors (`EPERM`, `EBUSY`, `EACCES`) retry asynchronously after bounded delays while retaining the lock and rechecking the original contents. A conflict or persistent write failure stops the turn before further commands. The panel remains responsive during retry delays; Stop and project identity are rechecked before host dispatch.

A receipt known not to have crossed the host boundary records `not_dispatched` (or `history_save_failed` for the initial proposal save) with `possiblyModified: false`. An actual dispatched script without a reliable host result remains `unknown`. A completed result that cannot be saved does not become permission to execute it again. The original on-disk archive is preserved on a failed replacement, so the UI explicitly reports when newer in-memory history was not saved.

Model context retains exact recent messages and paired tool results while they fit its 96,000-character budget. Older complete turns can be omitted with an explicit notice. If the active task still exceeds the budget, the request copy replaces bulky successful tool data with explicitly marked structural previews, oldest first. Exact script calls, IDs, outcome/target metadata and full local receipts are preserved. Missing values remain unknown; the assistant can request a smaller inspection. Error/unknown outcomes are never summarized into success. If exact source, messages or protected metadata still exceed the budget, the request stops. This changes model input only, not the complete local archive or command execution.

Active tokens are session-only. Ordinary local preferences contain the service URL, model and visual-check limit. The independent `settings.js` adapter optionally reads Hou-lm's preference schema and existing current-user Windows DPAPI login, without importing Houdini source or writing Hou-lm files. Ae-lm preferences override the shared defaults; a Settings button reloads Hou-lm's server/model. Startup attempts connection once using a matching saved Hou-lm login, independently of host identity synchronization. Missing credentials leave Settings open and failures do not retry automatically. Connect decrypts only a matching endpoint's login when the manual field is empty, using a bounded hidden Windows PowerShell process and private pipes. The exact saved URL remains the hash/entropy/envelope identity even when HTTP URL normalization changes its spelling. No Auto-run or project data is imported.

The transport validates TLS, rejects redirects and never retries automatically. HTTP remains accepted for compatible existing deployments; studios should use HTTPS or an appropriately protected connection. Project history never grants authorization or changes credentials.

Server deployment, studio knowledge ingestion and central policy/multi-user administration remain separate, deferred scope. See [validation](validation.md) for compatibility scope and acceptance checks.
