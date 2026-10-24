# Ae-lm

**An AI assistant for After Effects in studio pipelines.** A dockable CEP panel connected to your studio's Open WebUI service, with project inspection, reviewed ExtendScript execution and local conversation history.

`0.1.0-dev.1` is an **unsigned Windows preview**. Native panel opening, model replies and inspection calls have been observed on an artist workstation. Broader workstation/version coverage and the complete edit/save/resume workflow still need acceptance testing. See [validation](docs/validation.md).

## What it does

- Inspect compositions, layers, keyframes, expressions and existing diagnostics without starting previews or renders.
- Create and modify content using general model-written ExtendScript.
- Review scripts with **Apply once / Reject**, or enable **Auto-run scripts** for the current panel session.
- Expand compact activity cards to see exact commands and results.
- Save full conversations beside the AE project while keeping model context bounded.
- Reuse Hou-lm's local server/model settings and saved Windows login when available.

## Install on Windows

You need After Effects and access to a studio Open WebUI account. **No separate Node, Python, Git, npm or local server is needed.** The manifest allows AE 2024–2026; AE 2026 is experimental. This is a Windows preview, not a macOS package.

1. Download [the source ZIP](https://github.com/Byter3/Ae-lm/archive/refs/heads/main.zip) using **Code → Download ZIP**, or use a packaged ZIP from a successful [Client checks run](https://github.com/Byter3/Ae-lm/actions/workflows/tests.yml). Extract it.
2. Copy the extracted **`extension` folder**, rename the copy **`studio.aelm`**, and place it in:

   ```text
   %APPDATA%\Adobe\CEP\extensions\studio.aelm
   ```

   The resulting path must include `studio.aelm\CSXS\manifest.xml` directly, with no extra `extension` folder inside.
3. Open **Windows PowerShell from the Start menu**, as the Windows user who runs AE, and run:

   ```powershell
   reg.exe add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
   reg.exe add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f
   ```

   These per-user settings allow unsigned CEP extensions. Run them in normal Windows PowerShell, not AE's console or an app-embedded terminal. No administrator access or PowerShell execution-policy change is needed for these two commands.
4. Save your work and reopen AE normally. Choose **Window → Extensions → Ae-lm Assistant**, then dock the panel where you want it.
5. Open **Settings**, enter your studio's Open WebUI base URL and **your Open WebUI user API key or session token**, then click **Connect and load models**. Choose a model that supports tool calling.

If Hou-lm is already configured on that workstation, click **Use Hou-lm settings**, leave the key blank and connect. Saved credentials are protected for the Windows user; configure login on each workstation instead of copying credential files. Ae-lm stores only its URL/model preferences and holds active tokens in memory.

See [the install guide](docs/install.md) for upgrades, the optional installer and troubleshooting. Copying the folder and enabling unsigned CEP is sufficient; signing is not required for this preview.

## First test

Create or open a disposable composition, then send:

> Inspect the active composition. Report its name, dimensions, frame rate, duration and layer count. Do not change anything or render.

For a script test, leave Auto-run off:

> Add one null named AELM_TEST_CONTROL to the active composition. If that name already exists, stop. Show the proposed script for approval, then read back the layer name after approval without rendering.

Reject once and confirm nothing changed; repeat and approve once. More [test prompts](docs/first-milestone.md) cover recall and resume.

## Downloads and development

The source ZIP contains the complete installable `extension` folder. A successful GitHub **Actions → Client checks** run also provides the packaged artifact **Ae-lm-development-preview**; downloading Actions artifacts requires GitHub sign-in. Extract the artifact download, then its enclosed `Ae-lm-0.1.0-dev.1-windows.zip`. If a versioned release is published, the same package can be attached under [Releases](https://github.com/Byter3/Ae-lm/releases).

Developers can build the package with `python scripts/package_plugin.py`. The output is `dist/Ae-lm-0.1.0-dev.1-windows.zip`; `dist` is generated and excluded from Git. See [contributing](CONTRIBUTING.md) and [publication steps](docs/releasing.md).

## Project and execution boundaries

A saved `Shot.aep` uses `.aelm/Shot.aep.json` beside the project. Unsaved projects keep history in memory. Archives can contain private project details. Only bounded conversation context is sent to the configured service.

Scripts run with AE's permissions. Review and Undo groups are not a sandbox or guaranteed rollback. Stop cancels model waiting and prevents subsequent commands; an already dispatched host script may continue. Unknown execution outcomes are recorded and never replayed automatically. See [security](SECURITY.md).

[Hou-lm](https://github.com/Byter3/Hou-lm) is the Houdini client; [studio-assistant-backend](https://github.com/Byter3/studio-assistant-backend) owns the shared service examples. Each installs independently. Ae-lm does not deploy or reconfigure a server. [Architecture](docs/architecture.md) · [Assistant conventions](docs/assistant-conventions.md)

[MIT](LICENSE), copyright 2026 Byter3. Independent project; not an official Adobe product. Adobe After Effects and separately installed services retain their own licenses.
