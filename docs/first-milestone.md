# First working milestone

Status: planned; no After Effects runtime is implemented yet.

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

Run only after the implementation exists, using a disposable project and an active composition with at least one layer.

### Read-only inspection

> Inspect the active composition. Report its name, dimensions, frame rate, duration, and the names and types of its first ten layers. Do not change anything, render, or evaluate a preview. If no composition is active, say so.

Expected: a live read receipt, values matching the host and no edit/render. Layer types must be based on the installed API, not guessed labels.

### Exact result recall

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

## Offline cases required alongside the milestone

- Invalid/truncated tool arguments never execute.
- Reject, double Apply, response retry, reload and resume never duplicate a command.
- Interrupted execution restores as unknown, with no automatic retry.
- Missing, malformed and future-version sidecars fail safely without overwriting the original or crashing the panel.
- Imported history cannot enable Auto-run or change the service/credential identity.
- Recent exact results survive until the context budget requires reduction; call/result pairs stay valid after reduction.
- Model/history markup cannot load remote resources or invoke commands.
- Packaging includes only allowlisted client files and works without the source checkout.

These are future acceptance requirements. Record actual results and limitations when the implementation is tested.
