# Contributing to Ae-lm

Ae-lm 0.1.0-dev.1 is an unsigned development preview. Read [architecture](docs/architecture.md), [assistant conventions](docs/assistant-conventions.md) and [validation](docs/validation.md) before changing behavior.

## Source layout

| Path | Responsibility |
| --- | --- |
| `extension/index.html`, `panel.js`, `panel.css` | Dockable chat, settings, review and activity UI |
| `extension/CSXS/manifest.xml` | CEP host integration and version range |
| `extension/host/aelm.jsx` | AE inspection, general ExtendScript execution and consumed-ID ledger |
| `extension/lib/bridge.js` | Serialized CEP host calls and uncertain outcomes |
| `extension/lib/controller.js` | Agent loop, review, project identity and execution receipts |
| `extension/lib/transport.js`, `protocol.js` | Studio HTTP transport and complete tool-response validation |
| `extension/lib/settings.js` | Read-only Hou-lm preferences and Windows credential compatibility |
| `extension/lib/history.js`, `context.js` | Full local archive and bounded model context |
| `scripts/` | Explicit development installation and allowlisted packaging |
| `tests/` | Offline fixtures, synthetic browser check and opt-in native fixture |

Keep runtime code compatible with the embedded CEP Node/Chromium environment. Host `.jsx` code must use ExtendScript-compatible syntax; the newer AE expression engine is a separate language environment. Developer-installed Node is not an artist runtime dependency.

## Offline validation

Use a current Node release supporting `node:test` (the recorded development run used Node 24). No npm installation is required for the ordinary suite:

```sh
node --test tests/*.test.js
python -m unittest discover -s tests -p "test_*.py"
python scripts/package_plugin.py
```

The package builder requires Python 3.10 or later. Tests use synthetic model responses, mocked AE objects, temporary files and loopback HTTP fixtures; they do not contact a live model or edit an AE project. On restrictive Windows sandboxes, atomic file-renaming or loopback permissions may require running the same tests in an ordinary development shell. Do not weaken atomic-save or transport behavior to accommodate sandbox restrictions.

The optional browser test uses Playwright and a locally available Chromium executable:

```sh
node tests/ui-smoke.js
```

Provide Playwright through your development environment, including `NODE_PATH` if needed. This check mocks CEP, service responses and filesystem access. It is not native AE panel acceptance and is not part of the dependency-free test command.

## Native and service acceptance

`tests/native-host.jsx` is an opt-in fixture for a **fresh, empty, unsaved AE process**. It refuses a nonempty or saved project, then creates disposable composition/layer content. The caller supplies an absolute `AELM_NATIVE_RESULT` path. Read the fixture before launching it; never run it in an artist's current project. Native fixture success does not establish CEP installation, full panel interaction, Undo behavior or live model compatibility.

Installation and restart can wait until the artist can safely save and close AE. Do not stop or relaunch an existing session to satisfy ordinary development checks. Use the [acceptance prompts](docs/first-milestone.md) when a disposable project and explicit native test opportunity are available.

Live service tests are separate operations. They use the artist's configured account and may send project information; server changes are not a prerequisite for testing a client change. Record offline, browser, host and service evidence separately in [validation](docs/validation.md).

## Behavior and publication

- Preserve general model-written scripts; test prompts must not become hardcoded product recipes.
- Never replay commands on retry, reload or restored history. Unknown outcomes require inspection before further work.
- Keep exact recent tool results while they fit. Archive retention and model-context reduction are separate responsibilities.
- Inspect authored state and existing diagnostics routinely; render or evaluate expensive output only when requested.
- Keep approvals local and tokens outside project history. Auto-run starts off on each panel load.
- Render model/history content as text, not executable markup or external resources.
- Keep UI, transport, host execution and backend changes independently reviewable.

Build release artifacts from the explicit package allowlist. Exclude credentials, private project files, sidecars, media, diagnostics, screenshots and build output from Git. Keep the preview clearly labelled unsigned; studios may deploy it using the documented per-user CEP setting where permitted. Any later signed distribution needs its own packaging and native acceptance. Do not publish or tag a release merely because offline tests pass. Follow [publication steps](docs/releasing.md).

Ae-lm owns the AE client. [Hou-lm](https://github.com/Byter3/Hou-lm) and [studio-assistant-backend](https://github.com/Byter3/studio-assistant-backend) remain separate projects. Contributions are under the [MIT license](LICENSE).
