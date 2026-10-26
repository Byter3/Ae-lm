# Prepare a release

Current package version: `0.1.0-dev.1`. Publish it as an **unsigned Windows development preview**. Installation instructions are in [install.md](install.md).

## Review the candidate

1. Run the offline suites and package builder in [CONTRIBUTING](../CONTRIBUTING.md).
2. Review the diff and `git status --short --untracked-files=all`. Include only intended source, tests, documentation and workflow files. Check tracked and staged contents for credentials, private project data, histories, settings, diagnostics and local paths; ignore rules alone do not protect already tracked files.
3. Check the ZIP allowlist, checksum manifest and documentation links. Confirm installation still uses the complete extension folder and the two per-user `REG_SZ` CEP preferences.
4. Record native acceptance and remaining limits using [validation](validation.md). Keep documentation-only edits separate from runtime or server changes.
5. Commit or push only when requested. A local package or passing test run does not publish a release.

## Distribute the package

The repository's **Code → Download ZIP** includes the installable `extension/` folder. No artist build step is required.

A successful **Client checks** workflow uploads **Ae-lm-development-preview**, containing `Ae-lm-0.1.0-dev.1-windows.zip`. Actions artifacts require sign-in and expire according to repository settings.

For a permanent release download:

1. Select the reviewed commit with passing required checks. Use a new version/tag where appropriate; never move an existing published tag.
2. Build from that commit with `python scripts/package_plugin.py`, or use its successful workflow artifact.
3. Create a GitHub pre-release and attach the ZIP. Keep generated archives out of Git.
4. Verify extraction contains `Ae-lm/extension/CSXS/manifest.xml`, the README, installation guide and `SHA256SUMS.json`. Checksums detect corruption; they are not a signature.
5. Link installation instructions at the release tag and describe capabilities, compatibility limits and relevant validation. Add a direct download link only after the asset exists.

Suggested repository description:

> AI assistant for After Effects in studio workflows, with reviewed scripting, reference images and shared Open WebUI connections.
