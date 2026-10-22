# Application and repository boundaries

Decision: 22 October 2026. Status: accepted structure, host implementation pending.

## Independent applications

| Component | Ownership |
| --- | --- |
| Hou-lm | Houdini panel lifecycle, HOM tools, Python execution, HIP history, client packaging and Houdini acceptance |
| Ae-lm | After Effects interface, project/composition/layer tools, host scripting, project history, client packaging and AE acceptance |
| [studio-assistant-backend](https://github.com/Byter3/studio-assistant-backend) | Open WebUI/LiteLLM stack example, server setup, optional gateway adapter and backend tests |

Each client will execute tool requests only in its own host process. The studio backend performs model inference/routing; it does not gain a new workstation command endpoint from this repository split. A shared studio model alias does not share local conversations or approvals between clients.

The clients have independent releases. Hou-lm's existing package and artist-confirmed runtime remain intact. Ae-lm has no installable release until its own integration is implemented and tested.

## Shared behavior first

[Assistant conventions](assistant-conventions.md) describe the behaviors to preserve across applications. They are a design contract, not a new service API or a common on-disk schema.

Reference implementation: [Hou-lm v0.1.0](https://github.com/Byter3/Hou-lm/tree/2657f331395d4646135dd98dba0263285cdc3fe3), with the [artist-confirmed runtime baseline](https://github.com/Byter3/Hou-lm/tree/091265f248688dc100e75133ae854de39d573fbb). These references record provenance, not a claim that every draft AE requirement has already been implemented in Houdini.

Do not copy the Houdini panel into an AE runtime. Hou-lm's tool protocol imports host inspection/help, its model context reducer recognizes Houdini tool names and node/cook fields, and its history store assumes HIP filenames. These are application-specific boundaries even when individual functions appear generic.

Any later reuse must have a demonstrated common interface, explicit versioning, tests in both applications and packaged dependencies. No application may require a sibling checkout, an unpinned source download, or an artist-run package manager. A shared client-core repository is deferred until that evidence exists.

## Backend ownership

Use the studio's existing Open WebUI base URL and user account. The [server examples](https://github.com/Byter3/studio-assistant-backend/blob/main/docs/server-setup.md) and [optional gateway adapter](https://github.com/Byter3/studio-assistant-backend/tree/main/gateway) are maintained in studio-assistant-backend. Ae-lm does not duplicate a Compose stack, ship master/provider keys or deploy a second backend. The backend repository is the server deployment project, not the deferred shared client-code library.

The initial protocol target is the Open WebUI model list and chat-completion/tool-call interface already used by Hou-lm. Implement and verify it in the chosen AE client environment using synthetic fixtures. Preserve each application's tool names and host-specific instruction set; do not make the server reinterpret Houdini tools as After Effects operations.

Backend deployment, model compatibility and account administration are separate operations. Studio knowledge ingestion and central policy/multi-user testing remain deferred.

## Host integration decision

Panel technology, scripting bridge, runtime language, credential mechanism and installation format remain open until the installed After Effects version and Adobe's supported APIs are checked. Do not infer these from Houdini's Python/Qt implementation or promise compatibility across untested Adobe versions.

The first prototype should establish one application-local command boundary, a responsive interface, and a read-only composition query before building a full agent loop. It should not create a general network listener on the artist workstation merely to mimic another application's integration.
