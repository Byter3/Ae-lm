# Validation record

Preview: `0.1.0-dev.1`. Updated: 24 October 2026. This record separates artist-observed behavior, native fixture results and offline tests. Documentation/packaging preparation is separate from the context correction described below.

## Confirmed in the installed panel

The artist confirmed that the unsigned CEP panel opens after enabling CEP development mode from ordinary Windows PowerShell. A subsequent screenshot shows a selected studio model, assistant replies, and completed `activeComp` and `project` inspection receipts. The assistant reported no active composition and an empty project, then stopped without claiming to build the requested animation.

This establishes panel loading and a live model/tool exchange. The screenshot does not independently establish that the reported project state matched the host, that a complete animation was built, or which login method supplied the connection token. Shared-login reuse still needs its own native confirmation.

AE 25.6.6 and AE 26.5 were installed during testing, both with PlugPlug 12.0.1.2 and CEPHtmlEngine 12.0.1. The exact build used for the successful panel exchange was not recorded. Do not treat this as acceptance of every build in the manifest's AE 24.x–26.x range; AE 26.x remains experimental and AE 24.x has no native acceptance record.

## Native host fixture

The opt-in `tests/native-host.jsx` fixture completed on **Windows, After Effects 25.1x68** in a fresh empty unsaved project:

- The fresh empty/unsaved project guard passed.
- No-active-composition inspection returned an empty result.
- A disposable composition's authored dimensions were read.
- General ExtendScript created one null layer, and live readback found it.
- Reusing that execution ID was rejected without another layer being created.
- Reloading the host script retained the consumed execution ID.

These results cover the fixture's host operations, not the complete CEP workflow, Undo, project resume or other AE versions. The two command-line test processes later required force-closing after the artist confirmed both contained only test projects. Graceful shutdown was not validated. Further native acceptance should use the installed panel in a deliberately opened disposable project, not another automated application launch.

## Resolved startup issues

### Unsigned CEP preference

A registry trace showed AE reading `PlayerDebugMode` as missing, while automated checks reported it enabled. The automated process was reading an isolated Windows registry silo. Running the development preference command in the artist's ordinary, Start-menu-launched Windows PowerShell changed the registry view used by AE and resolved panel loading. The extension remains unsigned; no certificate workaround was needed. See [installation](install.md) for the commands.

A separate manifest defect was also corrected: CEP requires Height before Width in Size and MinSize. Packaging tests now reject the wrong geometry order. That correction alone did not resolve the unsigned-panel launch failure.

### CEP Node connection startup

The panel initially reported "Could not start the studio service connection." The transport used a browser URL object with Node HTTP. CEP 12's embedded Node 17.7.1 did not recognize that object as its URL overload, causing synchronous request startup to fail; newer standalone Node versions had masked the incompatibility.

The transport now imports Node's URL and passes an href string to HTTP/HTTPS. A regression fixture preserving Node 17's argument/listener behavior reproduced the error before the fix, then completed synthetic model-list GET and chat POST requests afterward. Targeted transport checks covered redirects, timeouts, cancellation and response bounds. The later artist screenshot confirms a live exchange, without establishing broader network reliability or how its token was supplied. No server or credential-store changes were part of the transport fix.

## Offline and synthetic checks

### Host output and item classification correction

A later saved receipt from AE **26.5x89** identified the next failure as `result_too_large`: a script had returned, but its serialized output exceeded the host's 100,000-character reply limit before reaching the context builder. The controller displayed a misleading generic script-failure message. Successful oversized output now produces a bounded partial capture with the completed execution identity intact. Existing text/array/object/depth capture limits are also marked explicitly. Omitted host output is unavailable locally, unlike data omitted only from a model request. Real exceptions still fail and stop the batch; error details are visible.

The same inspection sequence labeled a composition and folder as footage. Item classification now uses explicit branches instead of a nested conditional expression. An [ExtendScript parser report](https://illustrator.uservoice.com/forums/601447-illustrator-desktop-bugs/suggestions/51842079-extendscript-evaluates-nested-ternary-operator-wit) describes left-associative nested conditionals in another Adobe host; that interpretation matches the recorded labels. This is a compatibility explanation, not a native AE parser reproduction. An inactive selection can independently yield no active composition, so lookup by explicit composition ID remains supported.

This correction passed **112 JavaScript tests** without skips and **17 synthetic browser checks** in installed headless Chrome. Ten host-output regressions exercise the actual JSX in a mocked host; eight fail with the preceding host implementation and all ten pass with this correction. Four further tests cover item/layer classification and inactive composition lookup. Tests verify continuation and retry without repeated execution, preserved outcomes, and explicit partial capture. The browser check confirms the partial-output receipt label. The default bundled Playwright browser was unavailable; no browser was downloaded. Native acceptance after updating requires a normal saved-project AE restart because the existing bridge intentionally survives panel reloads; it has not been performed by these checks.

### Active-task result budget correction

The artist reported a local context-limit error after several successful inspections in one task. The client allowed a host reply up to 100,000 characters while its entire model context was limited to 96,000; only older user turns could previously be removed. A legal large result could therefore stop the current task before another model request was sent. The screenshot does not establish the exact size of each result.

The context builder now reduces bulky successful result data only when needed, using explicit partial-data markers in the model-facing copy. It keeps exact calls/source, status/target metadata and full local receipts, and preserves the newest exact result when possible. The controller's progress notice distinguishes result reduction from omitted older turns. Transport, host execution, credentials and the server are unchanged. Oversized exact source or protected outcomes can still cause a bounded failure. Native continuation after this correction remains to be tested; offline evidence is recorded below.

Run from the repository root:

```sh
node --test tests/*.test.js
python -m unittest discover -s tests -p "test_*.py"
python scripts/package_plugin.py
```

The suites cover protocol parsing, bounded transport, mocked host dispatch, review/execution state, history validation and conflicts, Save As, restore without replay, context call/result pairing, shared-setting boundaries and allowlisted packaging. They use synthetic responses, temporary files and loopback fixtures. They do not contact a live model, install a panel or modify an AE project. Record results for the exact revision being published; historical counts do not validate later changes.

The 24 October preparation passed **98 JavaScript tests** with no skips, including 12 active-task overflow regressions, and **7 packaging tests** with 2 Windows symlink checks skipped for insufficient symlink privileges (9 discovered). Sandboxed runs blocked temporary-file renames and loopback requests; the same offline suites passed in the normal development process. The overflow fixtures reproduced the old failure, check partial-data labeling and exact metadata/source retention, and prove a model retry does not execute the recorded script again. Package tests verify local documentation links and the explicit file allowlist. GitHub-hosted CI has not been run for this preparation.

A separate synthetic interoperability check encrypted a dummy login with Hou-lm's unchanged Python DPAPI code and read it with Ae-lm's Node/PowerShell reader. This confirms the tested storage-format compatibility, not native reuse of a real saved login.

`node tests/ui-smoke.js` is an optional Playwright check using synthetic CEP, service and filesystem adapters. Previous runs exercised review, Reject/Apply, collapsed receipts, literal HTML rendering, narrow-panel layout, project switching and shared settings. A successful synthetic UI check does not replace native acceptance. Windows packaging symlink tests may skip when the account lacks permission to create symlinks.

## Acceptance still required

- Compare a nonempty composition's inspection result with the visible host state.
- Exercise review, Reject, Apply and exact command/result inspection through the native panel; verify one intended edit and no duplicates.
- Confirm optional Hou-lm saved-login reuse separately from manual token entry.
- Save and reopen a disposable project; verify exact recall, Save As and no repeated edit.
- Test the relevant host Undo behavior separately.
- Record the AE build and Windows version on each additional workstation before claiming that combination is supported.

The [acceptance prompts](first-milestone.md) cover these steps. A complete animation and rendered output have not been independently verified. Routine inspection should not start a preview or render. Installation and restart should wait until existing work is saved; ordinary publication checks do not require an AE launch or server deployment change.
