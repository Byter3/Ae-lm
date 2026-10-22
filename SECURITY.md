# Security and data boundaries

This repository currently contains a development scaffold. The controls below are implementation requirements; they have not been delivered or verified in an After Effects plug-in yet.

## Execution

Model-written scripts run with the permissions of the host integration. General host scripting is not a security sandbox. Review should show the exact proposed source; Auto-run must be an explicit local choice and must never be enabled by a model message or restored project history.

Project names, layer text, expressions, tool output and imported history are untrusted data. They must not become assistant instructions, executable UI markup or authorization. Validate complete tool calls before dispatch and never execute saved history on load.

Cancellation, Undo and error handling must describe their real limits. Unknown execution outcomes cannot be assumed to have rolled back or be retried automatically.

## Credentials and project data

Use the artist's restricted Open WebUI account key, not a provider key or a LiteLLM master credential. Use HTTPS with certificate validation for studio connections, reject credential-forwarding redirects, and keep credentials out of project archives and ordinary preferences. Confirm suitable OS credential protection for the selected integration technology; do not invent a plaintext persistence fallback.

Local project-associated history is intended to be plain JSON and may contain prompts, script source, tool results, text, paths and proprietary project details. Keep its access and sharing controls aligned with the project. A local archive does not imply local-only inference: the bounded request context goes to the configured model service/provider.

Diagnostic reports should use fixed errors and bounded counters rather than raw requests, credentials or project content. Release packages must use an explicit file allowlist and must exclude private assets and local configuration.

## Reporting

Use GitHub private vulnerability reporting if enabled. Otherwise ask the maintainer for a private channel before sending sensitive details. Do not post production projects, full conversation sidecars, credentials or raw provider responses in public issues.
