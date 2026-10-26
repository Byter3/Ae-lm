# Work from reference images

Use a studio model that supports both images and tool calling. Ae-lm can compare references with the visible Composition viewer and make further edits while useful improvements remain.

## Attach references

Use **Attach**, drag an image into the message area, or paste an image. PNG, JPEG and WebP are supported, with up to three active references. Documents, video and arbitrary file attachments are not supported.

Draft thumbnails leave the composer when Send is accepted and remain on the sent message. The assistant can keep using those references in follow-ups without another upload. **Stop using references** stops including them in future requests; **Reuse references** puts them back in the composer. Unsent drafts are not retained when the panel closes.

With a reference attached, try:

> Describe the reference's layout, palette and typography. Suggest how to adapt it to the active composition. Do not change the project or capture the viewer. If the image is unavailable, say so.

## Let the assistant see the composition

Enable **Viewport access**, keep AE foreground, and leave the Composition viewer visible and unobstructed. Ae-lm automatically identifies a single visible Composition viewer. If the layout is ambiguous, use **Choose view** to select an AE region manually.

A manual selection is a fixed rectangle. Select it again after moving or resizing the window or rearranging panels. Turning Viewport access off clears the manual selection; enable it again to return to automatic detection. Both capture permission and manual selection reset when the panel opens. **Auto-run scripts** is a separate permission.

Test capture before asking for edits:

> Capture my only visible Composition viewer and describe what you can actually see. Do not modify anything, render, start playback or change the current frame. If the viewer cannot be identified, report that instead of capturing another pane.

Expand the capture receipt to compare the image with AE. Capture reads visible pixels; it does not start a render or preview and cannot establish whether paused output is freshly evaluated. A hidden, covered or unsupported view produces an error rather than a full-desktop fallback.

## Refine a design

With a reference attached and Viewport access enabled:

> Adapt this composition toward the reference using editable AE layers and controls. Inspect the existing structure first. After changes, capture the visible Composition viewer and compare composition, spacing, colors and readability. Keep refining while useful improvements remain within my visual-check budget. Preserve the current frame; do not render or start playback. Finish with what improved and what still differs.

Follow up without attaching the image again:

> Keep the same reference. Improve spacing and contrast only, then check the visible result once. Preserve the current frame and existing layer structure.

**Settings → Visual checks per task** defaults to 12 capture attempts and accepts 1–50. Failed capture attempts count; Retry retains the same task's count. The assistant should stop when the result is achieved, progress stalls, it needs your input, or the budget is exhausted. Increasing the limit permits more comparisons but does not guarantee a better result.

Scripts still require review unless Auto-run is enabled. After a returned script error, the assistant must inspect the remaining state before proposing a separate repair. Unknown execution outcomes and persistent history-save failures stop the task. Completed commands are never replayed automatically.

## Images, history and privacy

Images are resized to at most 1280 pixels on the long side and 512 KiB each. Source imports are limited to 20 MiB and 30 million pixels. Only active references and the current task's latest capture accompany a model request; older captures stay in local history.

For a saved project, images live in `.aelm/<project filename>.json.assets/` beside its JSON history. Save As carries the required images forward. Save an unsaved project before reloading the panel if you want to retain the conversation. Copy the JSON and assets folder with the project, and treat both as private studio material.

Viewer capture uses a bundled Windows helper. If studio policy blocks it, image attachments and ordinary scene tools remain available; ask your studio administrator about approving the helper. A floating CEP panel or an unusual viewer layout may need docking or manual selection. See [installation](install.md) and [security](../SECURITY.md).
