# Contributing

Read [architecture](docs/architecture.md) and the [behavior contract](docs/assistant-conventions.md). [Hou-lm](https://github.com/Byter3/Hou-lm) owns Houdini integration; [studio-assistant-backend](https://github.com/Byter3/studio-assistant-backend) owns service deployment.

## Source layout

| Path | Role |
| --- | --- |
| `extension/panel.*`, `index.html` | CEP UI |
| `extension/host/aelm.jsx` | ExtendScript bridge and execution ledger |
| `extension/lib/bridge.js`, `controller.js` | Host dispatch, agent loop and review |
| `extension/lib/transport.js`, `protocol.js` | HTTP and response validation |
| `extension/lib/history.js`, `context.js`, `settings.js` | Persistence, context and connection preferences |
| `extension/lib/visual*.js`, `image-*.js`, `extension/capture/` | Reference images and viewer capture |
| `scripts/`, `tests/` | Installation, packaging and fixtures |

Use CEP-compatible client syntax and ExtendScript-compatible host JSX. AE's expression engine is separate.

## Run offline checks

Node 22+ and Python 3.10+; no npm dependencies for the ordinary suites:

```sh
node --test tests/*.test.js
python -m unittest discover -s tests -p "test_*.py"
python scripts/package_plugin.py
```

Optional mocked browser check, with Playwright/Chromium available:

```sh
node tests/ui-smoke.js
```

## Native and service tests

Use the [test prompts](docs/first-milestone.md) and record [compatibility evidence](docs/validation.md). `tests/native-host.jsx` requires a fresh, empty, unsaved AE process and an absolute `AELM_NATIVE_RESULT` path. It creates disposable content; never run it in an artist's project. Native/service checks are separate from offline tests.

## Preserve behavior

Follow the [behavior contract](docs/assistant-conventions.md). Keep UI, transport, host execution, context and backend changes independently reviewable. Preserve general scripting, exact recent results and no-replay recovery. Add a useful prompt and targeted tests for behavioral changes.

## Packaging and publication

The allowlisted builder produces `dist/Ae-lm-0.1.0-dev.1-windows.zip`. Keep artifacts, credentials, project files, sidecars and diagnostics out of Git. See [release preparation](docs/releasing.md). Contributions are under [MIT](LICENSE).
