# Install Ae-lm

Client for the [studio assistant backend](https://github.com/Byter3/studio-assistant-backend). Windows, unsigned CEP preview; AE 24–26 manifest range, AE 26 experimental. [Compatibility](validation.md).

## Download and copy

Extract the [source ZIP](https://github.com/Byter3/Ae-lm/archive/refs/heads/main.zip). Copy the complete `extension/` folder to:

```text
%APPDATA%\Adobe\CEP\extensions\studio.aelm
```

The manifest must be at `studio.aelm\CSXS\manifest.xml`.

## Enable unsigned extensions

Run in normal **Windows PowerShell**, under the AE user's account:

```powershell
reg.exe add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
reg.exe add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f
```

These per-user settings enable unsigned CEP panels. Restart AE and open **Window → Extensions → Ae-lm Assistant**.

## Connect

In **Settings**, supply the Open WebUI base URL and user API key/session token, then **Connect and load models**. Use a tool-capable model; image tasks also require vision.

**Use Hou-lm settings** imports the companion client's URL/model. A matching saved Windows login supports automatic connection; leave the token blank to reuse it. Manually entered tokens last for the session.

## Upgrade

Close AE and replace `studio.aelm` completely. Keep backups outside `CEP/extensions`; avoid duplicate installations. Preferences and project history remain separate.

## Troubleshooting

For an invisible panel, check the manifest path, duplicate folders and `PlayerDebugMode` values: both must be `REG_SZ 1`. For connection failures, try a fresh Open WebUI user key. [Visual workflow](visual-workflow.md) · [Test prompts](first-milestone.md).

## Optional installer

From an extracted checkout, where scripts are permitted:

```powershell
.\scripts\install-dev.ps1 -EnableUnsigned
```

It refuses existing installations; use the upgrade procedure instead.

## Storage and uninstall

Remove `studio.aelm` with AE closed. Restore previous CEP preferences if no longer needed. Local settings and project-associated `.aelm` histories are retained.
