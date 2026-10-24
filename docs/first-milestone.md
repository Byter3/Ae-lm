# First working milestone

Status: implemented in unsigned development preview `0.1.0-dev.1`. The artist confirmed panel loading and a live model/inspection exchange; a separate native host fixture passed on Windows AE 25.1x68. The complete reviewed-edit and saved-conversation workflow still needs native acceptance. See [validation](validation.md).

The milestone is a complete small interaction: read the active composition, review and apply one change, show the exact command/result, and resume its saved conversation without replay. The generic host scripting path should support the edit; do not hardcode these prompts as product recipes.

## Deliverables

1. A host integration with recorded After Effects version, OS and supported APIs.
2. A read-only query for the active composition and a bounded layer summary, with a clear empty/no-composition result.
3. One-use script proposal review, Reject and Apply, plus a separate explicit Auto-run setting once manual review works.
4. Collapsible activity and exact script/result receipts with visible request progress.
5. Project-associated JSON storage, bounded request context and restore without command replay.
6. Synthetic offline tests, native disposable-project acceptance and an independently installable artifact.

Credential protection, service connectivity, installation technology and the AE tool schema must be verified as part of implementation. A working model chat or a scaffold documentation check does not satisfy native-host acceptance.

## Acceptance prompts

Run after installing the preview when it is safe to save and close existing AE work. Use a disposable project and an active composition with at least one layer. There is no need to interrupt an existing artist session to run these prompts now.

### Read-only inspection

> Inspect the active composition. Report its name, dimensions, frame rate, duration, and the names and types of its first ten layers. Do not change anything, render, or evaluate a preview. If no composition is active, say so.

Expected: a live read receipt, values matching the host and no edit/render. Layer types must be based on the installed API, not guessed labels.

### Exact result recall

To check item classification and composition discovery when nothing is selected:

> Inspect the project items and report their IDs and types. Find the existing main composition by its ID even if it is inactive, then report its layer count and the first five layer names and types. Do not modify anything, render or preview.

Expected: compositions, folders and footage have distinct types; a composition can be inspected by ID without being active. Large replies may show **completed · partial output** rather than failing. Omitted values must not be reported as empty or complete.

> Read the active composition's layer names. When finished, reply only Ready.

Then:

> Using only that previous tool result, list the exact layer names in order. Do not call tools again.

Expected: exact recall from retained tool results without an additional host read.

### Reviewed edit

With Auto-run off:

> Add one null layer named AELM_TEST_CONTROL to the active composition. If that name already exists, stop and report it. Show the proposed script for review before running it. After approval, check that the layer exists without rendering.

First reject the proposal and confirm no layer was created. Request the edit again, approve once, and confirm one layer and one execution receipt. Inspect the exact script. Test the host's supported Undo behavior separately; do not assume all possible script effects are transactional.

### Resume without replay

Save the disposable project, close/reopen the assistant, then send:

> From our saved conversation, explain what you changed. Do not execute it again. Then inspect whether AELM_TEST_CONTROL currently exists without changing anything or rendering.

Expected: historical explanation plus a clearly identified current read; still only one created layer. Save under a new project filename and confirm the new history contains earlier context while the original remains unchanged.

### Continue a detailed inspection

On an existing disposable animation, send:

> Refine the existing design without adding layers. First inspect only the ring strokes, background shape groups and title glitch controls you need. Return compact measurements and counts rather than dumping every vertex or keyframe. Make the ring markings finer, add variation within existing background groups, and tighten the title glitch timing. Preserve existing controls. Do not render or start a preview. If a result is marked partial, inspect only the missing properties; do not repeat a completed edit.

Expected: the task can continue after large result data is reduced for the model, with full exact results still in the activity cards. This is a practical behavior check, not a deterministic way to force overflow; the offline tests deliberately generate oversized results. Before reloading an unsaved panel session, save the AE project and wait until the footer displays its JSON filename. Retry resumes from recorded results and must not dispatch the same command again.

## Offline cases required alongside the milestone

- Invalid/truncated tool arguments never execute.
- Reject, double Apply, response retry, reload and resume never duplicate a command.
- Interrupted execution restores as unknown, with no automatic retry.
- Missing, malformed and future-version sidecars fail safely without overwriting the original or crashing the panel.
- Imported history cannot enable Auto-run or change the service/credential identity.
- Recent exact results survive until the context budget requires reduction; call/result pairs stay valid after reduction.
- Model/history markup cannot load remote resources or invoke commands.
- Packaging includes only allowlisted client files and works without the source checkout.

These cases have offline fixtures in `tests/`; run `node --test tests/*.test.js` for the current revision. Offline coverage does not replace the native panel and model prompts above. Record actual acceptance results and limitations in [validation](validation.md).
