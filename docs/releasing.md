# Publishing the Windows preview

Version: `0.1.0-dev.1`. Keep the release labelled **unsigned development preview**. Suggested GitHub repository description:

> AI assistant for After Effects in studio pipelines: dockable CEP panel, reviewed scripting, and shared Open WebUI connections.

## Prepare a reviewed commit

1. Run the offline commands in [CONTRIBUTING](../CONTRIBUTING.md), including the package tests and builder. Keep host/service tests separate.
2. Review `git status --short --untracked-files=all` and the actual diff. Stage only intended source, tests, documentation and workflow files. Credentials, `.aelm` histories, AE projects, local settings, diagnostics, trace captures and `dist` must stay excluded. Check staged filenames as well as contents; ignore rules do not remove files already tracked.
3. Confirm the install guide includes the exact folder layout and `REG_SZ` unsigned-CEP commands, run from ordinary Windows PowerShell. Record precisely which native flows were tested in [validation](validation.md).
4. Keep `extension/` unchanged during documentation-only cleanup. If runtime changes are necessary, review and test them separately.
5. Commit the reviewed files locally. Push only after publication is authorized. Neither the package builder nor tests push a repository, install the panel or change the service.

## Downloadable source and build artifact

Once the commit is pushed, **Code → Download ZIP** includes the installable `extension/` folder; artists can use the manual installation instructions without building anything.

The **Client checks** workflow tests Windows and Ubuntu. Its package job runs only after both test jobs pass and uploads **Ae-lm-development-preview**. Download it from the successful run's Artifacts section, then extract its enclosed `Ae-lm-0.1.0-dev.1-windows.zip`. Actions artifacts require sign-in and are retained according to repository settings; they are not a permanent public release asset. Configuring a workflow is not evidence its hosted run passed.

## Optional versioned GitHub release

When explicitly ready to publish a version:

1. Select the exact reviewed commit and ensure its required checks passed. Create tag `v0.1.0-dev.1` at that commit; do not move an existing published tag.
2. Build from that same commit with `python scripts/package_plugin.py`, or obtain the package from that commit's successful workflow run.
3. Create a GitHub **pre-release** for the tag, titled `Ae-lm 0.1.0-dev.1 — unsigned Windows preview`.
4. Attach `Ae-lm-0.1.0-dev.1-windows.zip`. Do not commit generated ZIPs into the source tree. The archive includes `SHA256SUMS.json` for file-integrity checks; this is not a signature.
5. Include the supported scope, installation link, test prompts and known limits. Verify the published ZIP extracts to `Ae-lm/extension/CSXS/manifest.xml` and includes its README.

Suggested release description:

> A dockable After Effects assistant for studios using an existing Open WebUI service. Includes project inspection, general ExtendScript proposals with Apply/Reject or session Auto-run, collapsible command receipts, project-associated JSON history and optional Hou-lm connection reuse.
>
> Windows unsigned preview: copy the extension folder and enable CEP development mode using the [installation guide](install.md). No separate Node, Python, Git or local server is needed. The manifest permits AE 2024–2026, with AE 2026 experimental; see [validation](validation.md) for tested scope. General scripts run with AE permissions. Full cross-workstation, edit/resume and Undo acceptance remains to be completed.

For GitHub's release body, use links to those documents at the release tag, rather than relative links that resolve against the release page. Do not claim a release asset exists before it has been uploaded.
