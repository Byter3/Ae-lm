# Compatibility and validation

**Unsigned Windows preview · 0.1.0-dev.1.** The manifest permits AE 24–26; AE 26 is experimental. macOS is unsupported.

## Established scope

The CEP panel has completed live model/tool exchanges and reference-image comparisons on an artist workstation. A native fixture passed on AE 25.1x68. AE 25.6.6 and 26.5 were present during panel testing, without per-flow build records; AE 24 has no native acceptance record.

## Offline checks

Run [Contributing](../CONTRIBUTING.md#run-offline-checks). Tests use synthetic responses, mock hosts and temporary files. Record results for the candidate revision separately from native/service acceptance.

## Native acceptance

On a disposable project, record code revision, AE/Windows build and capture layout. Check:

- Panel loading, connection and accurate inspection.
- Reject/Apply, exact receipts and error recovery.
- Save, reopen, Save As and recent-result recall without replay.
- Reference input, viewer capture and permission reset.

Use [test prompts](first-milestone.md) and [visual checks](visual-workflow.md). Verify each target host/layout; offline tests do not establish native compatibility or rendered quality.

## Update checks

Replace the complete extension and restart AE after host JSX changes. Panel-only reload retains the previous host bridge. Client updates do not require a backend deployment.
