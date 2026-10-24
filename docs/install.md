# Install Ae-lm on another workstation

**Copy the extension folder, enable unsigned CEP for your Windows user, then open the panel in AE.** This unsigned Windows preview needs no separate Node, Python, Git, npm or workstation server. AE 2024–2026 are allowed by the manifest; compatibility across that range is not fully tested. See [validation](validation.md).

## 1. Download and copy

Download **Code → Download ZIP** from [Ae-lm](https://github.com/Byter3/Ae-lm), or download the **Ae-lm-development-preview** artifact from a successful **Actions → Client checks** run. The Actions download contains the packaged ZIP; extract that ZIP as well. A published release may provide the packaged ZIP directly under Releases → Assets.

Copy the extracted `extension` folder into the directory below, naming the copy `studio.aelm`. Paste `%APPDATA%\Adobe\CEP\extensions` into File Explorer's address bar; create missing folders if necessary.

```text
%APPDATA%\Adobe\CEP\extensions\studio.aelm\
    CSXS\manifest.xml
    host\aelm.jsx
    lib\...
    index.html
    panel.js
    panel.css
```

Copy the complete folder, not just `manifest.xml`. Do not leave an extra `Ae-lm` or `extension` directory between `studio.aelm` and `CSXS`. For an existing installation, use the upgrade steps below.

## 2. Allow unsigned CEP extensions

Open **Windows PowerShell from the Windows Start menu**, under the same user account that runs AE. Run both commands:

```powershell
reg.exe add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
reg.exe add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f
```

`CSXS.11` covers CEP 11 hosts; `CSXS.12` covers CEP 12, including the tested AE 2025/2026 installations. `PlayerDebugMode` must be a **REG_SZ string** with value `1`. It affects other unsigned extensions using these runtimes too. Use your studio's approved per-user configuration if these settings are centrally managed.

These commands do not need administrator access or a PowerShell execution-policy change. **Do not run them inside AE or an app-embedded terminal.** During development, an app's isolated registry made the value appear configured while AE could not see it; normal Start-menu PowerShell resolved that issue. No signing certificate is needed for this preview.

## 3. Open and connect

Save your work, close AE normally and reopen it. Choose **Window → Extensions → Ae-lm Assistant**. Dock the panel like other AE panels.

- **Inspect** reads the active composition locally and needs no login.
- In **Settings**, enter the studio Open WebUI base URL, for example `https://ai.studio.example`, and your **Open WebUI user API key or session token**. This field is not your account password or a LiteLLM master/provider key. Click **Connect and load models** and choose a tool-capable model.
- If Hou-lm is configured for this Windows user on this workstation, select **Use Hou-lm settings**, leave the key blank and connect. Ae-lm's own saved choices otherwise take precedence.

Reconnect when reopening the panel. Manually entered tokens remain in memory. Saved Hou-lm login reuse reads Windows current-user DPAPI storage through a bounded hidden PowerShell helper. If no login is saved or studio policy blocks that helper, enter the key manually. Configure each workstation separately; do not distribute credential files with the extension.

## 4. Test

Create or open a disposable composition and send:

> Inspect the active composition. Report its name, dimensions, frame rate, duration and layer count. Do not change anything or render.

Expect an inspection receipt and an answer matching AE. If no composition exists, the assistant should report that honestly. For a reviewed edit, keep Auto-run off:

> Add one null named AELM_TEST_CONTROL to the active composition. If it exists, stop. Show the exact script for approval. After approval, read back the layer name without rendering.

Reject once, then request again and approve once. Check the expanded command receipt. See [more acceptance prompts](first-milestone.md).

## Upgrade

1. Save work and close AE normally.
2. Move the existing `studio.aelm` folder to a backup location **outside** `Adobe\CEP\extensions`. Renamed copies left inside that directory may still be discovered by CEP.
3. Copy the new `extension` folder to the same `studio.aelm` destination and reopen AE. The per-user registry commands only need repeating if the values are missing or changed.

Preferences and project histories live outside the extension folder and are preserved. Auto-run resets to off. Do not merge arbitrary old extension files into the new copy.

## If it does not appear or open

- Check `studio.aelm\CSXS\manifest.xml` is at the exact location above, and that AE was reopened after installation.
- In **normal Start-menu PowerShell**, verify the string values:

  ```powershell
  reg.exe query "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode
  reg.exe query "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode
  ```

  The relevant runtime must show `REG_SZ` and `1`. Re-run the matching `reg.exe add` command if it does not. Use the artist's Windows account.
- Remove duplicate Ae-lm copies from CEP's extension directory by moving them to a backup location elsewhere.
- A panel that opens but cannot connect is a separate issue. Check the URL and account access, or try a manually entered Open WebUI key. Replacing the extension does not require changing the studio server.

## Optional scripted installer

Manual installation above avoids PowerShell script-policy restrictions. If local policy permits `.ps1` scripts, you can instead extract the package to a local folder such as Downloads and run this from normal Windows PowerShell:

```powershell
& 'C:\path\to\Ae-lm\scripts\install-dev.ps1' -EnableUnsigned
```

The installer copies the allowlisted files and sets the same two per-user CEP preferences. It refuses existing installations and linked/reparse-point paths, which can include synced locations. If it reports that scripts are disabled, use the manual steps; changing system execution policy is unnecessary. For upgrades, use the steps above.

## Storage and removal

Ae-lm's URL/model preferences are in `%USERPROFILE%\.aelm-settings.json`. Optional Hou-lm preferences come from `%LOCALAPPDATA%\Hou-lm\preferences.json` or the `HOULM_CONFIG_DIR` inherited by AE. Its encrypted login always stays under `%LOCALAPPDATA%\Hou-lm\credentials`; Ae-lm only reads it. Auto-run permissions are not shared.

Full conversation history is `.aelm/<project filename>.json` beside saved `.aep`/`.aepx` files. Unsaved projects stay in memory. Save As carries history to a new filename while preserving an existing destination history as a conflict. Treat these JSON archives as private project data.

To uninstall, close AE and remove only `studio.aelm` from CEP's extension directory. This preserves preferences and histories. If unsigned CEP was enabled solely for this preview, restore the two registry values to their previous state; setting them to `0` disables unsigned extensions and can affect other development panels. [Security details](../SECURITY.md).
