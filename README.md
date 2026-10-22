# Ae-lm

An After Effects assistant for studio workflows, designed to use a studio's existing Open WebUI service and model access.

**Development scaffold. There is no installable After Effects plug-in or working host integration in this repository yet.** The first milestone is defined below; supported After Effects versions, the panel technology and distribution format will be recorded after a host integration prototype is validated.

## Project boundaries

Ae-lm owns the After Effects interface, project/composition/layer tools, script execution, local conversation storage and its eventual installable package. [Hou-lm](https://github.com/Byter3/Hou-lm) remains the separate Houdini product with its own releases and artist-confirmed baseline.

Both clients are intended to use the same studio-managed Open WebUI service, optionally backed by LiteLLM. Artists use their own account and permitted models. Each client executes tools only in its own host application. Installing one plug-in will not require installing the other.

The initial shared asset is a set of [assistant conventions](docs/assistant-conventions.md), not an executable shared library. No shared client-core repository, submodule or cross-repository runtime dependency has been introduced. Shared code will be extracted only when both working clients demonstrate a useful common interface.

## First milestone

1. Inspect the active composition and report observed properties and layers.
2. Propose one small edit with the exact script available for review.
3. Apply it once after approval and show the execution result in a collapsed receipt.
4. Save and resume the conversation beside the project without replaying commands.

See [the milestone and test prompts](docs/first-milestone.md). Inspection, review, Auto-run, persistence, credential storage and bounded model context are requirements to implement, not features already delivered by this scaffold.

## Development

- [Architecture](docs/architecture.md): ownership, backend boundary and integration decisions.
- [Assistant conventions](docs/assistant-conventions.md): review, history, context and truthful reporting requirements.
- [Contributing](CONTRIBUTING.md): staged development and validation.
- [Security](SECURITY.md): execution and project-data boundaries.

The shared [studio-assistant-backend](https://github.com/Byter3/studio-assistant-backend) repository owns the Open WebUI/LiteLLM stack example, setup guide and optional streaming adapter. A working studio service can be reused; this scaffold does not deploy or modify a server. Backend deployment and client releases remain independent.

## License

[MIT](LICENSE), copyright 2026 Byter3. Adobe After Effects and separately installed model/server dependencies have their own licenses. This is an independent project, not an official Adobe product.
