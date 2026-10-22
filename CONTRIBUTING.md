# Contributing to Ae-lm

Ae-lm is currently an implementation starting point. It has no runtime, installable package or automated plug-in tests yet. Do not describe documentation checks as successful After Effects integration.

## Scope

This repository owns the After Effects client. The existing Houdini client remains in [Hou-lm](https://github.com/Byter3/Hou-lm). The separate [studio-assistant-backend](https://github.com/Byter3/studio-assistant-backend) repository owns deployment examples and the optional gateway adapter; both clients can use the same configured service. There is no shared executable core dependency.

Start with [architecture](docs/architecture.md) and the [first milestone](docs/first-milestone.md). Confirm the installed host version and available official integration APIs before selecting technology or adding dependencies.

## Implementation order

1. Establish a minimal native host integration and perform a read-only composition query. Record the exact After Effects version, operating system and integration technology.
2. Add one reviewed general-script execution path with a one-use approval and truthful command receipt.
3. Add project-associated history and resume without replay, including corruption and interrupted-execution cases.
4. Connect the existing studio model service through the agreed tool-call flow, using synthetic offline protocol tests before live model tests.
5. Produce an independently installable client artifact and validate it without a development checkout.

Keep each subsystem's changes and evidence separate. Use a disposable project for native acceptance. Do not use another application's live scene, a production project or a server change as an ordinary test prerequisite.

## Validation

There is no test command to run at scaffold stage. The first implementation must add an offline test command and CI appropriate to its actual language/runtime. Do not add a placeholder passing test that implies the plug-in works.

Maintain three distinct validation records:

- **Offline:** synthetic protocol, history, state-machine, markup and package checks. No real credentials, network model or host project required.
- **Host:** interaction with an installed After Effects version and a disposable project; confirms inspection, review, execution and reload behavior.
- **Service:** explicitly requested model/backend tests, separate from ordinary code or documentation checks.

Record unsupported environments and skips. Include the relevant [test prompt](docs/first-milestone.md#acceptance-prompts) with UI or assistant behavior changes.

## Publication

Use a public noreply author identity if desired; Git commits expose author metadata. Review staged files and their history before publishing. Keep credentials, private projects, histories, media, diagnostics, screenshots and build output out of Git.

Create an installable release only after the host prototype and packaging are tested. Future artists should download a versioned asset from GitHub Releases that includes every required client dependency. Updating Hou-lm must not automatically update Ae-lm or the studio backend.

Contributions are under the [MIT license](LICENSE).
