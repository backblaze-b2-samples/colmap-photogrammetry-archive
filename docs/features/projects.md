<!-- last_verified: 2026-08-06 -->
# Feature: Projects

## Purpose
The **Project** is the primary entity — a structure-from-motion archive scene.
Each project holds its source photos and every derived COLMAP artifact under its
own B2 prefix, indexed by a `manifest.json`. This feature covers the full
lifecycle (create / read / edit / delete / run) and the project-scoped asset
explorer.

## Used By
- UI: `/projects` (library) and `/projects/[slug]` (detail)
- API: `GET/POST /projects`, `GET/PATCH/DELETE /projects/{slug}`, `POST /projects/{slug}/run`, `GET /projects/{slug}/artifacts`, `GET /projects/{slug}/artifacts/download`, `GET /projects/stats`, `GET /projects/capabilities`

## Core Functions
- `services/api/app/service/projects.py` — CRUD + slug derivation + live overlay + dashboard aggregation; the shared in-process run guard (`_run_lock`, `_running`)
- `services/api/app/service/project_artifacts.py` — the scoped asset explorer (`list_artifacts`, `presign_artifact`)
- `services/api/app/repo/manifest.py` — read/write `projects/<slug>/manifest.json`; scan `projects/` for every manifest (B2 is the sole store)
- `services/api/app/repo/artifacts.py` — project-scoped B2 put/get/list, presign, and prefix-scoped delete
- `apps/web/src/components/projects/` — `projects-library.tsx`, `project-card.tsx`, `project-form.tsx`, `project-detail.tsx`, `asset-explorer.tsx`, `project-status.tsx`
- `apps/web/src/lib/queries.ts` — `useProjects`, `useProject`, `useCreateProject`, `useUpdateProject`, `useDeleteProject`, `useRunProject`, `useProjectArtifacts`, `useProjectCapabilities`

## Primary-entity lifecycle (all five verbs in the UI)
- **create** — "New Project" dialog on `/projects` (`project-form.tsx`).
- **read** — Projects library cards + project detail + scoped asset explorer.
- **edit** — "Edit" dialog on the detail page, pre-filled from the manifest.
- **delete** — "Delete" with a shadcn `AlertDialog`; removes only `projects/<slug>/` (prefix-scoped — never a bucket-wide wipe).
- **run** — "Run reconstruction" → the background COLMAP pipeline (see [Reconstruction pipeline](reconstruction-pipeline.md)).

## Form UX conventions (create/edit)
Finite-value fields are selectors, never free text, on both create and edit:
- `matcher` → `Select` (exhaustive / sequential / spatial)
- `quality` → `Select` (low / medium / high)
- `max_image_dim` → `Select` (1024 / 1600 / 2048 / original)
- `enable_dense` → `Switch`, **disabled with a "CUDA required" hint** when `GET /projects/capabilities` reports no GPU

Free text is only for `name` and the optional `source_prefix`. The **create**
form supplies safe defaults as placeholder / description guidance (matcher =
sequential, quality = medium, max_image_dim = 1600, dense = off) — guidance only,
never an autofill button. The **edit** form opens pre-filled from the project's
real settings.

## Inputs / Outputs
- Create/Update body: `{ name, matcher, quality, max_image_dim, enable_dense, source_prefix }` (Update fields all optional)
- `Project` includes: slug, status, settings, `images_archived`, `stats` (ReconstructionStats), `write_amplification`, `stages` (PipelineStage[]), `artifacts` (ArtifactEntry[])
- `GET /projects/{slug}/artifacts` → `ArtifactEntry[]` (kind inferred: images / database / sparse / points / dense / manifest)

## Edge Cases
- Duplicate name → a unique slug is derived (`statue`, then `statue-<hex>`).
- Editing a project mid-run → 409 (settings apply to the next run).
- Delete of a missing slug → 404. A malformed slug in a scoped download → 404 (the presign is confined to the project prefix).
- Reconstruction with fewer than 3 photos → the Run action is disabled with a hint (and the API returns 400).

## Verification
- Test files: `services/api/tests/test_projects.py`, `services/api/tests/test_upload_targets.py`
- Required cases: slug derivation + uniqueness, update-only-sent-fields, live image/amplification overlay, prefix-scoped delete, scoped explorer kinds, dashboard aggregation
- Focused verify command: `pnpm test:api`
- Default pre-PR verify command: `pnpm verify`
- Full local verify command: `pnpm verify:full` when the E2E/live prerequisites in [Dev Workflows](../dev-workflows.md#commands) are available
- Pass criteria: focused tests and `pnpm verify` green; explain any skipped `pnpm verify:full` prerequisites

## Related Docs
- [Reconstruction pipeline](reconstruction-pipeline.md)
- [Write amplification](write-amplification.md)
- [File Upload](file-upload.md)
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
