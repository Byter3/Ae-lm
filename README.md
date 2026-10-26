# Ae-lm

**An After Effects assistant for studio workflows.** Inspect compositions, build and refine editable animation, and run reviewed scripts through your studio's Open WebUI service.

**Unsigned Windows preview · 0.1.0-dev.1 · After Effects 2024–2026**
The manifest allows these versions; coverage varies by build and workstation. AE 2026 remains experimental. See [compatibility and testing](docs/validation.md).

## Install

You need After Effects, an Open WebUI account, and a model with tool calling. Image tasks also need a model that accepts images. No separate Node, Python, Git, npm or local server is required.

1. [Download the source ZIP](https://github.com/Byter3/Ae-lm/archive/refs/heads/main.zip) and extract it.
2. Copy its complete `extension` folder to `%APPDATA%\Adobe\CEP\extensions\studio.aelm`. The result must contain `studio.aelm\CSXS\manifest.xml`, with no extra `extension` folder inside.
3. Open **Windows PowerShell from the Start menu**, as the user who runs AE, and run:

   ```powershell
   reg.exe add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
   reg.exe add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f
   ```

   These settings allow unsigned CEP extensions for your Windows user. No signing certificate, administrator access or execution-policy change is needed.
4. Save your work and reopen AE. Choose **Window → Extensions → Ae-lm Assistant** and dock the panel.
5. In **Settings**, enter your studio's Open WebUI base URL and **user API key or session token**, click **Connect and load models**, then choose a model. The token field is not an account-password field.

If Hou-lm has a saved Windows login for the same server, Ae-lm connects automatically. **Use Hou-lm settings** imports its server/model choices; leave the token blank to use the matching saved login. Manually entered tokens last for the panel session.

[Installation, upgrades and troubleshooting](docs/install.md) includes the optional installer and uninstall steps. A successful [Client checks run](https://github.com/Byter3/Ae-lm/actions/workflows/tests.yml) also offers the packaged **Ae-lm-development-preview** artifact; Actions downloads require GitHub sign-in. Extract the download and its enclosed plug-in ZIP.

## Use the assistant

Open a composition and describe what you want to inspect, create or change. Start with:

> Inspect the active composition. Report its name, dimensions, frame rate, duration and layer count. Do not change anything or render.

- **Inspect** reads the active composition locally, without a model connection.
- Review proposed scripts with **Apply once / Reject**, or enable **Auto-run scripts** for the current session.
- Expand activity cards to see the exact scripts and results.
- **Attach**, drop or paste up to three reference images. Sent references stay available for follow-ups; **Stop using references** removes them from future requests.
- Enable **Viewport access** to let the assistant inspect the visible Composition viewer. This permission is separate from Auto-run and resets when the panel opens.
- **Settings → Visual checks per task** controls repeated visual comparisons: 12 by default, adjustable from 1 to 50.

The assistant can inspect results and propose further corrections. Routine inspection does not start a preview or render. Scripts run with AE's permissions; an error can leave partial changes. **Stop** prevents later commands but may not interrupt a script already running in AE.

## Save and resume

Save the AE project to retain its conversation. `Shot.aep` uses `.aelm/Shot.aep.json` beside the project, with reference images and captures in `.aelm/Shot.aep.json.assets/`. Save As carries the history forward. Unsaved conversations remain in memory.

The full local archive is separate from the bounded context sent to the model. Reload and retry do not replay completed commands. Keep the JSON and assets folder with the project, and treat them as private studio material.

| Guide | What it covers |
| --- | --- |
| [Installation](docs/install.md) | Workstation setup, upgrades and connection troubleshooting |
| [Visual workflow](docs/visual-workflow.md) | References, viewer capture and refinement prompts |
| [Test prompts](docs/first-milestone.md) | Inspection, review, recall and resume |
| [Security](SECURITY.md) | Script permissions, credentials and project data |
| [Contributing](CONTRIBUTING.md) | Developer setup, tests and packaging |

[Hou-lm](https://github.com/Byter3/Hou-lm) provides the Houdini assistant. [studio-assistant-backend](https://github.com/Byter3/studio-assistant-backend) provides shared service examples. Each client installs independently and uses your existing service.

[MIT](LICENSE), copyright 2026 Byter3. Independent project; not an official Adobe product.
