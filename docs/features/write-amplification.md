<!-- last_verified: 2026-08-06 -->
# Feature: Write amplification

## Purpose
The headline metric of this sample. A photogrammetry reconstruction turns a set
of source photos into a fan-out of derived artifacts — the SIFT match
`database.db`, the sparse model, `points.ply`, and (on CUDA) a dense cloud —
whose combined footprint often meets or exceeds the source bytes. **Write
amplification** quantifies that fan-out and makes the case for B2 as the single
storage layer that absorbs it and serves it back.

## Definition
```
ratio = artifact_bytes / source_bytes
```
- **source_bytes** — total bytes of the project's source photos (under `projects/<slug>/images/`, or the project's `source_prefix`).
- **artifact_bytes** — total bytes of every derived object under `projects/<slug>/` except the source photos and `manifest.json`.
- A ratio ≥ 1 means the reconstruction produced at least as many bytes of derived artifacts as the input photos.

## Used By
- UI: the **write-amplification panel** (hero metric) on `/projects/[slug]`, the amplification pill on each project card, the hero stat tile + per-project chart on the dashboard.
- API: computed server-side and returned inside every `Project` (`write_amplification`) and in `GET /projects/stats` (overall `ratio`).

## Core Functions
- `services/api/app/service/projects.py` — `_amplification_from_objs()` computes source/artifact bytes + ratio from a single scoped B2 listing; `_overlay_live()` attaches it to each project; `get_project_stats()` aggregates the overall ratio across all projects.
- `services/api/app/service/reconstruction_runner.py` — recomputes amplification after a run once every artifact is uploaded, and persists it to the manifest.
- `apps/web/src/components/projects/write-amplification-panel.tsx` — the source-vs-artifact bar + ratio.
- `apps/web/src/components/dashboard/amplification-chart.tsx` — per-project source vs artifact MB.

## Why it's computed from B2, not tracked separately
Because B2 is the sole store, the metric is always derived from the live bucket
listing of the project's prefix — there is no separate accounting to drift. The
same `list_objects_v2` scan that powers the scoped asset explorer also feeds the
amplification numbers, so what you see is exactly what's on B2.

## Outputs (`WriteAmplification`)
`source_bytes`, `source_bytes_human`, `artifact_bytes`, `artifact_bytes_human`,
`ratio`.

## Edge Cases
- No photos yet → `source_bytes = 0`, `ratio = 0.0` (shown as "—").
- A custom `source_prefix` points outside the project prefix → the source bytes measured at run time are used (they can't be derived from a `projects/<slug>/` scan alone).
- Overall dashboard ratio divides summed artifact bytes by summed source bytes across every project.

## Verification
- Test files: `services/api/tests/test_projects.py` (`test_get_overlays_live_image_count_and_amplification`, `test_dashboard_stats_aggregate_amplification`)
- Required cases: per-project ratio from a scoped listing, overall aggregate ratio, zero-source safety
- Focused verify command: `pnpm test:api`
- Default pre-PR verify command: `pnpm verify`
- Full local verify command: `pnpm verify:full` when the E2E/live prerequisites in [Dev Workflows](../dev-workflows.md#commands) are available
- Pass criteria: focused tests and `pnpm verify` green; explain any skipped `pnpm verify:full` prerequisites

## Related Docs
- [Dashboard](dashboard.md)
- [Projects](projects.md)
- [Reconstruction pipeline](reconstruction-pipeline.md)
