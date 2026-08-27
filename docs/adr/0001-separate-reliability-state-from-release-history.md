---
status: accepted, no longer exercised
---

# Separate reliability state from release history

오늘비 publishes each validated Reliability Snapshot to a dedicated reliability-state branch instead of main. This preserves Git's atomic history and existing repository credentials while preventing daily learning updates from becoming application releases; Vercel deployment is explicitly disabled for the state branch.

## Considered options

- Keep state on main: simplest storage, but every successful daily cycle enters the production release path.
- Use a separate repository or object store: stronger infrastructure isolation, but adds credentials, operational setup, and a new durable-storage implementation.
- Use a dedicated branch in this repository: retains atomic Git publication, recovery history, and the existing raw read path without new infrastructure.

## Consequences

The branch must be seeded from the current Reliability Snapshot before state is removed from main. The scheduled transaction may publish only the canonical snapshot, must fast-forward from the observed branch revision, and must fail closed on malformed or regressing history. Runtime code reads learned weights from the dedicated branch; local output is ignored on main.

## Inert since 2026-08-27

The separation this record describes still holds; nothing exercises it any more.
[ADR 0008](./0008-retire-the-second-scoring-pipeline-and-the-retired-scene.md) deleted the
pipeline that published Reliability Snapshots, so `GitStateTarget` and
`scripts/reliability-state.ts` are gone from the tree and nothing writes to
`reliability-state`. Nothing has read it since `/api/sky` was removed on 2026-08-22.

The branch and its converged history stay on the remote, so the published state remains
recoverable; it is a frozen artefact rather than live storage. The one instruction here that
is still load-bearing is the deployment guard: `vercel.json` keeps
`deploymentEnabled: {"reliability-state": false}`, because the branch still exists and
anything pushed to it would otherwise produce a deployment.

Read this record as history. Deleting the branch would be a separate decision and is not
taken here.
