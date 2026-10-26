# Contributing to Ae-lm

Read [architecture](docs/architecture.md), [assistant conventions](docs/assistant-conventions.md) and [validation](docs/validation.md) before changing behavior. Ae-lm is an unsigned Windows preview; Houdini and server work belong in their separate repositories.

## Source layout

| Path | Responsibility |
| --- | --- |
| `extension/index.html`, `panel.js`, `panel.css` | Chat, settings, review and activity UI |
| `extension/CSXS/manifest.xml` | CEP host integration and version range |
| `extension/host/aelm.jsx` | Inspection, general ExtendScript execution and consumed execution IDs |
| `extension/lib/bridge.js`, `controller.js` | Serialized host calls, agent loop, review, project identity and receipts |
| `extension/lib/transport.js`, `protocol.js` | HTTP transport and complete response validation |
| `extension/lib/settings.js` | Local preferences and read-only Hou-lm login compatibility |
| `extension/lib/history.js`, `context.js` | Local archive and bounded model context |
| `extension/lib/visuals.js`, `image-*.js`, `visible-capture.js`, `extension/capture/` | References, image preparation and visible-view capture |
| `scripts/`, `tests/` | Installation, packaging and offline/native fixtures |

Client code must work in CEP's embedded Node/Chromium environment. Host JSX must use ExtendScript-compatible syntax; AE's newer expression engine is separate. Artist installation must not require a developer Node runtime or sibling checkout.

## Run offline checks

Use Node 22 or later and Python 3.10 or later. No npm installation is needed for the ordinary suites:

```sh
node --test tests/*.test.js
python -m unittest discover -s tests -p "test_*.py"
python scripts/package_plugin.py
```

These checks use synthetic responses, mocked AE objects, temporary files and loopback fixtures. They do not contact a live model, install the panel or edit an AE project. Use an ordinary development shell if sandbox restrictions prevent temporary renames or loopback access; do not weaken runtime behavior to make restricted fixtures pass.

The optional browser check requires Playwright and a locally available Chromium executable:

```sh
node tests/ui-smoke.js
```

Supply Playwright through the development environment, including `NODE_PATH` if needed. This check also mocks CEP and the service.

## Native and service tests

Use the [acceptance prompts](docs/first-milestone.md) in a disposable project, recording the exact revision and host build as described in [validation](docs/validation.md).

`tests/native-host.jsx` is an opt-in fixture for a fresh, empty, unsaved AE process. It creates disposable content and requires an absolute `AELM_NATIVE_RESULT` path. Read it before use; never run it in an artist's existing project. Do not interrupt an active session for routine checks.

Live model requests and server changes are separate operations. Keep native-host, panel, browser and service evidence distinct.

## Preserve behavior

- Preserve general model-written scripting; prompts must not become hardcoded task recipes.
- Never replay commands on retry, reload or resume. Distinguish a known returned error from an unknown execution outcome.
- Keep exact recent tool results while they fit. Archive retention and model-context reduction are separate responsibilities.
- Read authored state and existing diagnostics routinely; render or evaluate expensive output only when requested.
- Keep approvals local, tokens outside project history, and Auto-run/Viewport access off on panel load.
- Render model/history content as text, not executable markup or external resources.
- Keep UI, transport, host, model-context and server changes independently reviewable.

## Packaging and publication

`python scripts/package_plugin.py` writes `dist/Ae-lm-0.1.0-dev.1-windows.zip` from an explicit file allowlist. The package includes dependencies and documentation needed by artists; `dist/` remains ignored. Follow [release preparation](docs/releasing.md) before publication.

Do not commit credentials, private projects, sidecars, media, diagnostics or local backups. Include a useful test prompt for panel behavior changes. Contributions are under the [MIT license](LICENSE).
