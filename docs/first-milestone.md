# Test prompts

Use a disposable composition. Compare tool receipts with AE, not just the assistant's prose.

## Inspect without editing

> Inspect the active composition. Report its name, dimensions, frame rate, duration and first ten layer names/types. Do not edit, render or preview.

## Recall exact results

> Read the active composition's layer names. Reply only Ready.

Then:

> Using only that result, list the exact layer names in order. Do not call tools again.

## Review a change

With Auto-run off:

> Add one null named AELM_TEST_CONTROL. Stop if it exists. Show the script for review; after approval, inspect the result without rendering.

Reject once, then request again and apply. Confirm exactly one null and one execution receipt.

## Resume without replay

Save and reopen the panel:

> Summarize our previous edit from history, then inspect whether AELM_TEST_CONTROL exists. Do not repeat the edit.

Save As and confirm the new sidecar retains the conversation.

## Recover from a returned script error

> Propose a script that creates AELM_RECOVERY_TEST and deliberately throws an Error. Stop if it exists. After approval and failure, inspect the remaining state, then propose a separate rename to AELM_RECOVERY_REPAIRED. Do not rerun the failed source or create another null.

Expect inspection before a separately reviewable repair. Unknown execution outcomes must stop.

## Visual checks

Use the [visual prompt](visual-workflow.md#refine-a-design). Check capture against the viewer and confirm disabling viewport access blocks further captures. Record the revision and host build using [validation](validation.md).
