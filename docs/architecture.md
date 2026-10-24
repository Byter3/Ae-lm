# Architecture

Decision: 22 October 2026. Implementation: unsigned Windows preview `0.1.0-dev.1`.

## Application boundaries

| Component | Ownership |
| --- | --- |
| [Hou-lm](https://github.com/Byter3/Hou-lm) | Houdini panel, HOM/Python tools, HIP history and packaging |
| Ae-lm | AE panel, composition/layer/property inspection, ExtendScript execution, project history and packaging |
| [studio-assistant-backend](https://github.com/Byter3/studio-assistant-backend) | Open WebUI/LiteLLM server examples, optional gateway adapter and backend tests |

Clients use the same studio service but execute commands only in their own application. They do not share approval state or project histories. Releases are independent; no sibling checkout, shared executable client library, runtime download or artist package manager is required.

[Assistant conventions](assistant-conventions.md) are the shared behavior contract. Houdini-specific source is not imported into AE. The [Hou-lm reference release](https://github.com/Byter3/Hou-lm/tree/2657f331395d4646135dd98dba0263285cdc3fe3) remains unchanged by AE development.

## Host integration

The preview uses a dockable **CEP panel**, a CommonJS client running in CEP's embedded Node environment, and a small **ExtendScript** host bridge. CEP's `evalScript` interface dispatches a JSON-encoded method and argument envelope to `AELM.dispatch`. The execution source is data inside that envelope; only the explicit execution method evaluates it.

Adobe documents panel docking, embedded runtimes and host scripting in the [CEP cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md). The manifest permits AE 24.x/25.x and experimental AE 26.x testing. The artist confirmed panel loading and a live model/inspection exchange, but the successful host build was not recorded. Separate native fixture evidence covers **AE 25.1x68 on Windows**. Neither establishes acceptance of the whole declared range; see [validation](validation.md).

UXP is a future adapter target. Adobe's [announced transition](https://blog.developer.adobe.com/en/publish/2026/09/investing-in-the-future-of-creative-cloud-extensibility-uxp-comes-to-our-flagship-applications) puts AE UXP public beta by November 2026 and CEP removal from new app versions in December 2029; ExtendScript itself is unaffected. Keep panel integration, host dispatch and agent logic separated so a later port does not rewrite execution/history rules.

MCP is not required between this embedded panel and AE. No workstation HTTP listener or external MCP process is started. A future MCP adapter must reuse the same local review and execution boundary rather than add an unchecked command path.

## Data flow

1. The panel sends bounded conversation context and AE tool definitions to Open WebUI's `/api/chat/completions`; `/api/models` supplies the model list.
2. The complete response is parsed and every tool request validated before any request from that response is dispatched.
3. `ae_inspect` reads bounded authored project/composition/layer/property state and existing diagnostics. It does not request a preview or render.
4. `ae_run_script` proposes general ExtendScript. Local review or explicit Auto-run authorizes the exact proposal; the host checks project identity and consumes its execution ID before running it.
5. The result and exact source enter the receipt and archive. A subsequent model request uses recorded results; retry and restore do not redispatch old commands.

Host calls are serialized. AE executes ExtendScript on its main thread, so cancelling an HTTP request does not prove a dispatched script stopped. The bridge records unknown outcomes and blocks further calls until the artist can inspect AE. Errors may leave partial changes; named Undo groups are not transactions or a security sandbox.

Successful host output that exceeds the reply limit is returned as an explicitly partial capture, preserving the completed execution ID and outcome. `_aelmHost.partial` and the receipt's **partial output** label identify this case. Omitted output was never captured by the panel and is not available in the archive; a smaller targeted inspection can obtain missing values without repeating an edit. This differs from request-context reduction, where full captured receipts remain locally available. Actual script exceptions still stop the batch and retain their error details.

The host bridge is retained inside AE so panel reloads do not reset consumed command IDs. After updating `extension/host/aelm.jsx`, save work and restart AE normally to load the new host implementation. Reopening only the panel is insufficient for a host-code update.

## Storage and connection

The full versioned archive is `.aelm/<project filename>.json` beside saved `.aep`/`.aepx` files; unsaved projects remain in memory. Save As carries the archive to a new destination while preserving the original. Existing destination histories, malformed files, locks and concurrent changes fail without silent replacement. Atomic writes use an exclusive lock and baseline-content check.

Model context retains exact recent messages and paired tool results while they fit its 96,000-character budget. Older complete turns can be omitted with an explicit notice. If the active task still exceeds the budget, the request copy replaces bulky successful tool data with explicitly marked structural previews, oldest first. Exact script calls, IDs, outcome/target metadata and full local receipts are preserved. Missing values remain unknown; the assistant can request a smaller inspection. Error/unknown outcomes are never summarized into success. If exact source, messages or protected metadata still exceed the budget, the request stops. This changes model input only, not the complete local archive or command execution.

Active tokens are session-only. Ordinary local preferences contain only service URL/model. The independent `settings.js` adapter optionally reads Hou-lm's preference schema and existing current-user Windows DPAPI login, without importing Houdini source or writing Hou-lm files. Ae-lm preferences override the shared defaults; a Settings button reloads Hou-lm's server/model. Connect decrypts only a matching endpoint's login when the manual field is empty, using a bounded hidden Windows PowerShell process and private pipes. The exact saved URL remains the hash/entropy/envelope identity even when HTTP URL normalization changes its spelling. No Auto-run or project data is imported.

The transport validates TLS, rejects redirects and never retries automatically. HTTP remains accepted for compatible existing deployments; studios should use HTTPS or an appropriately protected connection. Project history never grants authorization or changes credentials.

Server deployment, studio knowledge ingestion and central policy/multi-user administration remain separate, deferred scope. See [validation](validation.md) for completed checks and pending acceptance.
