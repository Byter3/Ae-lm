# Visual workflow

Use a vision/tool-capable model from the [shared backend](https://github.com/Byter3/studio-assistant-backend).

## Attach references

**Attach**, drop or paste up to three PNG/JPEG/WebP images. Sent thumbnails leave the composer but stay active for follow-ups. **Stop using references** excludes them; **Reuse references** returns them to the composer. Unsent drafts do not survive panel closure.

## Let the assistant see the composition

Enable **Viewport access** with AE foreground and one unobstructed Composition viewer visible. Detection is automatic; **Choose view** handles ambiguous layouts. Reselect a manual region after changing the layout.

Capture reads visible pixels without rendering, playback or frame changes. It does not establish fresh evaluation. Capture permission resets on panel load and is separate from **Auto-run scripts**.

## Refine a design

**Settings → Visual checks per task:** 12 attempts by default, adjustable to 1–50. Failed captures count; Retry keeps the task's count.

> Match the reference using editable layers and controls. Inspect the existing comp, make focused changes, capture the result and refine the largest remaining differences within the visual-check budget. Preserve the current frame; do not render or start playback. Report unresolved differences.

## Images, history and privacy

Model images are capped at 1280 pixels/512 KiB. Only active references and the current task's latest capture are sent. Saved assets live in `.aelm/<project filename>.json.assets/`; move them with the JSON. Save As carries them forward.

[Installation](install.md) · [Data handling](../SECURITY.md) · [Houdini equivalent](https://github.com/Byter3/Hou-lm/blob/main/docs/visual-reference.md).
