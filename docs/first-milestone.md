# Test prompts

Use a disposable project with an active composition. These prompts check the installed panel and selected studio model; the expected outcomes below are checks to perform, not a guarantee of model behavior.

## Inspect without editing

> Inspect the active composition. Report its name, dimensions, frame rate, duration, and the names and types of its first ten layers. Do not change anything, render or start a preview. If no composition is active, say so.

Expand the receipt and compare the values with AE. To check composition discovery when nothing is selected:

> Inspect the project items and report their IDs and types. Find the existing main composition by ID even if inactive, then report its layer count and first five layer names. Do not modify anything, render or preview.

Compositions, folders and footage should have distinct types. A receipt marked **partial output** means omitted values are unavailable, not empty.

## Recall exact results

> Read the active composition's layer names. When finished, reply only Ready.

Then:

> Using only that previous tool result, list the exact layer names in order. Do not call tools again.

Compare the answer with the original receipt. No additional tool call should be needed while the result remains in model context.

## Review a change

With Auto-run off:

> Add one null named AELM_TEST_CONTROL to the active composition. If it already exists, stop. Show the script for review. After approval, check that the layer exists without rendering.

Reject once and confirm no layer was created. Request it again and apply once. Confirm one layer and one execution receipt, then inspect the exact script. Test AE Undo separately; it cannot reverse every possible script effect.

## Resume without replay

Save the project, close and reopen the assistant, then send:

> From our saved conversation, explain what you changed. Do not execute it again. Then inspect whether AELM_TEST_CONTROL currently exists without changing anything or rendering.

Expect a historical explanation followed by a current read, with no duplicate layer. Save As under a new filename and confirm the new history contains the conversation while the original sidecar remains.

## Recover from a returned script error

This intentionally creates a partial failure. Use a disposable composition with Auto-run off:

> Inspect the active composition, then propose a small script that creates one null named AELM_RECOVERY_TEST and deliberately throws an Error afterward. If that name exists, stop. After I approve and the error returns, do not rerun the source or create another null. Use ae_inspect to read the remaining layer, then propose a separate repair renaming it AELM_RECOVERY_REPAIRED. Do not render, preview or change frames.

Expect the error to remain visible and a fresh successful inspection before a separately reviewable repair. Reject the repair and confirm no second edit. In a fresh disposable setup, repeat and approve; only one null should remain. A timeout with an unknown execution outcome must stop instead of automatically repairing or replaying the script.

## Visual checks

Use the attachment, capture and refinement prompts in [Visual workflow](visual-workflow.md). Compare captured pixels with the actual viewer, test Viewport access off, and confirm sent references remain usable in follow-ups.

Maintainers should record results against the exact code revision and host build using the [validation guide](validation.md).
