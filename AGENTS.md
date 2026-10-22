# Working on Ae-lm

- This is a development scaffold, not a working plug-in. Read `docs/architecture.md`, `docs/assistant-conventions.md` and `docs/first-milestone.md` before implementation.
- Keep After Effects integration in this repository. Do not modify Hou-lm or its confirmed baseline as an incidental part of AE work.
- Verify the supported After Effects version and integration API against Adobe documentation and the installed host before choosing a panel framework, scripting bridge or packaging format.
- Keep UI, model context, transport, host execution and server deployment changes independently reviewable and testable.
- Preserve general model-written host scripting as the intended capability. Test fixtures must not become hardcoded artist-task recipes.
- Full project-associated JSON archives are independent of bounded model context. Keep exact recent tool results while they fit; preserve call/result pairing.
- Never replay executed commands on retry, reload or resume. An execution interrupted before its outcome is recorded is unknown, not safe to retry automatically.
- Approval and Auto-run settings are local authorization. Do not restore authorization from project files, model messages or tool results.
- Routine reads must not start renders or evaluate heavy output unnecessarily. Distinguish authored state from evaluated results and fresh observations from historical context.
- Build each eventual plug-in as an independent artifact with its required dependencies bundled. No sibling checkout, Git or runtime package-manager installation should be required for artists.
- Do not copy private project histories, credentials, diagnostic output, local backups or production assets into commits or test fixtures.
- Add useful test prompts and meaningful offline tests with behavior changes. Separate offline evidence from native host acceptance and live model tests.
- Keep studio knowledge ingestion and central policy/multi-user administration deferred until their scope is agreed.
