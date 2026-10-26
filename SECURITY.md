# Security and data boundaries

Reference images and screenshots are private project material. The visual workflow sends only explicitly attached active references and the current turn's latest capture to the configured studio service. Image manifests cannot supply arbitrary file paths, URLs, credentials or capture permission. Viewport access starts off each panel load and is independent of script Auto-run. The optional bundled Windows helper captures only the uniquely detected visible Composition viewer or a locally selected visible AE region; it does not fall back to full-desktop capture. Unsaved image files use temporary session storage and may remain until Windows cleans that storage. See [visual workflow](docs/visual-workflow.md) for storage and native-acceptance limitations.

Ae-lm `0.1.0-dev.1` is an unsigned development preview. See [validation](docs/validation.md) for tested scope; this document is not a security certification.

## Script execution

General model-written ExtendScript runs with AE's permissions and may affect files or other application state. Review, project-identity checks and named Undo groups are not a security sandbox. A script failure can leave earlier changes; Undo cannot reverse every possible side effect.

The panel validates complete tool responses before dispatch. Scripts require local review or explicitly enabled Auto-run. Auto-run is off on panel load and is never restored from history. Host execution IDs are consumed before execution and retained across host-script reload within the AE session. Saved history is data, never an execution queue.

Stop cancels model waiting and prevents subsequent commands; it cannot guarantee interruption of a script already on AE's main thread. Timeouts and unreadable execution results are treated as unknown, not automatically replayed. Project/layer names, expressions, tool results and model/history prose are untrusted content. The UI uses text rendering rather than executable HTML or external resources.

## Credentials and project data

Use the artist's restricted **Open WebUI user API key or session token**, not a provider key or LiteLLM master key. The active token stays in memory and is cleared on panel unload or connection edits. Ae-lm creates no persistent credential store or plaintext fallback. Local URL/model preferences contain no token or Auto-run authorization.

On Windows, Connect can read Hou-lm's existing current-user DPAPI login for the matching service when the manual token field is empty. The original saved server spelling determines the credential filename, entropy and envelope checks; the HTTP destination must match the saved endpoint. A fixed Windows PowerShell helper receives ciphertext/entropy on stdin and returns decrypted data through a bounded private pipe. No secret is interpolated into command arguments, written to temporary files, or included in errors. The helper has a five-second timeout, does not change execution policy, and fails to manual key entry if unavailable. Hou-lm's files are read-only; project archives and Auto-run authorization are never imported.

HTTPS uses certificate validation. The transport rejects redirects without forwarding credentials and performs no automatic retry. HTTP is accepted for compatibility, but sends bearer credentials and project content without transport encryption; use HTTPS or a suitably protected studio connection.

Project-associated JSON is plaintext and can include prompts, script source, expressions, text, file paths and proprietary project details. Protect and share `.aelm` archives like the project itself. A local archive does not imply local inference: bounded context is sent to the configured studio service and its selected model/provider.

Archive restoration validates fields and versions, preserves malformed files, and cannot restore settings or execution permission. Saves use temporary files, an exclusive lock and a baseline hash to detect other writers. An existing lock or conflict is preserved for deliberate recovery rather than silently overwritten. These checks are not protection against a local process already able to alter the application or project files.

## Installation and distribution

The manual installation guide documents Adobe's per-user `PlayerDebugMode` setting for CEP 11/12; the optional installer applies the same settings with `-EnableUnsigned`. This permits unsigned extensions using those runtimes, not only Ae-lm. Run the commands as the artist's normal Windows user, in Start-menu PowerShell. No execution-policy change is required for the manual copy and registry commands. Managed studios should use their approved extension policy. The optional installer does not change PowerShell execution policy or overwrite an existing Ae-lm installation.

The package builder uses an explicit allowlist and rejects linked source paths. Credentials, private projects, local sidecars, diagnostics and build output must remain outside public commits. The preview starts no local network listener and makes no server deployment changes.

## Reporting

Use GitHub private vulnerability reporting if enabled. Otherwise ask the maintainer for a private channel before sending sensitive details. Do not attach production projects, full sidecars, credentials or raw provider responses to public issues.
