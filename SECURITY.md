# Security and project data

Scripts run with AE's permissions. Review and Undo groups are not a sandbox; errors may leave partial changes. Auto-run and viewport access start off. Retry and history restoration never replay completed commands.

Use an Open WebUI **user** key/session token. Manual credentials stay in memory; Ae-lm can reuse a matching Windows-protected [Hou-lm](https://github.com/Byter3/Hou-lm) login. Use HTTPS or a protected studio connection.

Relevant project context, active references and requested captures go to the configured service/provider. Local `.aelm` JSON and image assets are unencrypted project data. Keep credentials, histories and production assets out of public reports.

Unsigned CEP preferences apply to other panels using the same runtime; follow studio policy.

Report vulnerabilities through GitHub's private reporting channel, if enabled, or request a private contact. [Backend security](https://github.com/Byter3/studio-assistant-backend/blob/main/SECURITY.md).
