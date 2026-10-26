# Install Ae-lm on Windows

Copy the extension, allow unsigned CEP extensions for your Windows user, then open the panel. The preview requires no signing certificate or separate runtime installation. The manifest permits After Effects 2024–2026; see [compatibility](validation.md).

## Download and copy

Download [the source ZIP](https://github.com/Byter3/Ae-lm/archive/refs/heads/main.zip) and extract it. Alternatively, use **Ae-lm-development-preview** from a successful [Client checks run](https://github.com/Byter3/Ae-lm/actions/workflows/tests.yml), extracting its enclosed plug-in ZIP too.

Copy the complete `extension` folder into `%APPDATA%\Adobe\CEP\extensions`, naming the copy `studio.aelm`. Paste that path into File Explorer and create missing directories if needed.

```text
%APPDATA%\Adobe\CEP\extensions\studio.aelm\
    CSXS\manifest.xml
    host\aelm.jsx
    lib\...
    capture\visible-capture.ps1
    index.html
    panel.js
    panel.css
```

There must be no extra `extension` or `Ae-lm` folder between `studio.aelm` and `CSXS`. For an existing installation, follow [Upgrade](#upgrade).

## Enable unsigned extensions

Open **Windows PowerShell from the Start menu**, under the same Windows account that runs AE, and run:

```powershell
reg.exe add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
reg.exe add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f
```

The values must be **REG_SZ strings** containing `1`. They apply to all unsigned extensions using CEP 11/12, not only Ae-lm. Use your studio's approved configuration where these preferences are managed centrally. Run the commands in normal Windows PowerShell, not AE's console or an app-embedded terminal. No administrator access or PowerShell policy change is needed.

Save your work and reopen AE normally. Choose **Window → Extensions → Ae-lm Assistant**.

## Connect

In **Settings**, enter your Open WebUI base URL, such as `https://ai.studio.example`, and your **Open WebUI user API key or session token**. Click **Connect and load models** and choose a tool-capable model. Do not enter your password, a provider key or a LiteLLM master key.

A matching saved Hou-lm Windows login enables automatic connection when the panel opens. **Use Hou-lm settings** loads its URL/model choices; leave the token field blank and connect to use that saved login. If reuse is unavailable, enter your user key manually. Manual tokens remain in memory until the panel closes. Configure each workstation separately rather than copying credential files.

Open a disposable composition and test:

> Inspect the active composition. Report its name, dimensions, frame rate, duration and layer count. Do not change anything or render.

Expand the inspection receipt and compare it with AE. [More test prompts](first-milestone.md) cover reviewed edits and saved conversations.

## Upgrade

1. Save work and close AE normally.
2. Move the old `studio.aelm` folder to a backup location **outside** `Adobe\CEP\extensions`; CEP may discover renamed copies left inside it.
3. Copy the new complete `extension` folder to `studio.aelm`, then reopen AE.

Preferences and project histories are preserved. Auto-run and Viewport access start off. Repeat the registry commands only if their values are missing or changed. Use a complete replacement rather than merging old and new extension files.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Panel missing or clicking it does nothing | Confirm the exact `studio.aelm\CSXS\manifest.xml` path, restart AE, and move duplicate copies outside the extensions directory. |
| Unsigned panel still blocked | In normal Start-menu PowerShell, run the two queries below. Each relevant entry must show `REG_SZ` and `1`. |
| Panel opens but cannot connect | Check the base URL and your Open WebUI account access. Try a manually entered user key if saved-login reuse fails. |
| Viewer capture fails | Keep AE foreground and the Composition viewer visible; use the [visual guide](visual-workflow.md) for layout and policy checks. |

```powershell
reg.exe query "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode
reg.exe query "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode
```

## Optional installer

If your workstation permits PowerShell scripts, this performs the same copy and unsigned-CEP setup:

```powershell
& 'C:\path\to\Ae-lm\scripts\install-dev.ps1' -EnableUnsigned
```

Run it in normal Windows PowerShell from an extracted local copy. It refuses existing installations and linked paths. If scripts are disabled or a synced/linked path is rejected, use the manual steps above; no system execution-policy change is required. Use the upgrade steps to replace an existing installation.

## Storage and uninstall

Preferences are stored in `%USERPROFILE%\.aelm-settings.json`. Saved project history is `.aelm/<project filename>.json`, with images in the adjacent `.json.assets` directory. Save before closing an unsaved session to retain its conversation.

To uninstall, close AE and remove only `studio.aelm` from the CEP extensions directory. Preferences and project histories remain. If unsigned CEP was enabled solely for Ae-lm, restore the registry values to their previous state; setting them to `0` also disables other unsigned panels using those runtimes. See [security and data handling](../SECURITY.md).
