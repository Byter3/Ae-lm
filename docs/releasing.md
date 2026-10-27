# Release checklist

Publish `0.1.0-dev.1` as an unsigned Windows preview. Keep runtime version, artifact name and release notes consistent for subsequent versions.

1. Run [offline checks](../CONTRIBUTING.md#run-offline-checks) and the relevant [native acceptance](validation.md).
2. Review the diff and tracked/untracked files for credentials, private projects, histories and diagnostics.
3. Build with `python scripts/package_plugin.py`; verify the allowlist, `SHA256SUMS.json` and packaged documentation links.
4. Publish the reviewed commit and attach the ZIP to a GitHub pre-release. Preserve existing release tags.
5. Verify `Ae-lm/extension/CSXS/manifest.xml` after extraction and link the [installation guide](install.md) at that tag.

A successful **Client checks** workflow provides an **Ae-lm-development-preview** build artifact. GitHub's source ZIP also contains the installable `extension/` folder. Keep generated archives out of Git; add release download links only after the assets exist.
