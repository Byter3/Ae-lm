# Compatibility and validation

Ae-lm `0.1.0-dev.1` is an unsigned Windows preview. The manifest permits AE 24.x–26.x; that range is not a claim that every build, studio policy or viewer layout has been tested. AE 26.x remains experimental. macOS is not supported by this package.

## Established scope

- The unsigned CEP panel has opened on an artist workstation and completed live model/tool exchanges.
- A disposable native host fixture passed on Windows AE **25.1x68**: composition inspection, one scripted null creation, readback and rejection of a reused execution ID, including after host-script reload.
- Artist feedback includes a completed viewer-capture receipt and a model comparison against a reference. This does not establish every layout, render freshness or visual refinement quality.
- AE 25.6.6 and 26.5 were present during panel testing, but the exact build for each observed panel flow was not recorded. AE 24.x has no native acceptance record.

Full installation, reviewed editing, saved-history resume, Undo and visual refinement should be checked on each workstation/version combination before production use. A fixture or successful model response does not establish those complete workflows.

## Offline checks

Run the commands in [CONTRIBUTING](../CONTRIBUTING.md). They cover protocol parsing, context bounds, mocked host calls, review and execution state, persistence, reference images, capture permissions and allowlisted packaging. Fixtures use synthetic data and do not launch AE or contact a real model. The optional browser check also mocks CEP and service responses.

Record pass/fail/skip totals for the exact candidate revision in its pull request or release checklist. Historical counts do not validate a newer build. Keep private diagnostics, screenshots, project files and histories out of the repository.

## Native acceptance

Use the installed panel with a deliberately opened disposable project. Do not launch a replacement AE process or interrupt existing work for routine checks. Record:

| Area | Required check |
| --- | --- |
| Environment | Code revision, AE and Windows builds; DPI and docking layout for capture changes |
| Installation | Unsigned CEP setup, panel opening and model connection |
| Inspection | Values and types match a nonempty composition, including lookup by ID |
| Editing | Reject leaves the project unchanged; Apply creates one intended edit and a correct receipt |
| Recovery | Known errors require fresh inspection and a new proposal; unknown outcomes stop |
| History | Save, reopen, exact recent recall and Save As preserve context without replay |
| Images | Reference input reaches the selected model; capture matches the visible Composition viewer |
| Permissions | Auto-run and Viewport access reset off; disabling capture prevents it |

Use the [test prompts](first-milestone.md) and [visual prompts](visual-workflow.md). Keep offline, browser, native-host and live-service results separate. Note untested behavior explicitly, including Undo and final rendered output.

## Update checks

After updating host JSX, save work and restart AE normally: the host bridge deliberately survives panel-only reloads. The [installation guide](install.md) uses a full replacement and restart so all bundled components load together. No server deployment is required for a client documentation or packaging update.
