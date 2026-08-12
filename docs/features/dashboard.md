<!-- last_verified: 2026-08-06 -->
# Feature: Dashboard

## Purpose
Give an at-a-glance overview of the photogrammetry archive: how many projects
exist, how many photos are archived, and — the headline — how far the source
photos fan out into derived reconstruction artifacts on B2 (the overall
write-amplification ratio).

## Used By
- UI: `/` page (dashboard home)
- API: `GET /projects/stats`, `GET /projects`

## Core Functions
- `apps/web/src/components/dashboard/archive-stats.tsx` — five stat cards (write-amplification ratio as the hero tile, then projects, photos archived, source bytes on B2, artifact bytes on B2)
- `apps/web/src/components/dashboard/amplification-chart.tsx` — per-project source vs artifact bytes (the fan-out story)
- `apps/web/src/components/dashboard/recent-projects.tsx` — recent projects with status, photo count, and amplification
- `apps/web/src/lib/queries.ts` — `useProjectStats()`, `useProjects()`
- `services/api/app/runtime/projects.py` — `GET /projects/stats`
- `services/api/app/service/projects.py` — `get_project_stats()` (aggregates every project's write amplification from a single `projects/` scan)

## Canonical Files
- Dashboard aggregation: `services/api/app/service/projects.py`
- Hero stat cards: `apps/web/src/components/dashboard/archive-stats.tsx`

## Inputs
- None (dashboard loads data automatically)

## Outputs
- `GET /projects/stats` → `ProjectStats` (total_projects, draft/running/archived/failed, images_archived, sparse_points, source_bytes(_human), artifact_bytes(_human), ratio)
- `GET /projects` → `Project[]` for the chart and recent-projects table

## Flow
- Page loads → TanStack Query fetches stats + the project list.
- `get_project_stats()` does ONE `list_objects_v2` scan under `projects/`, groups objects by slug, overlays each manifest with live source/artifact bytes, and sums them into the overall ratio (artifact_bytes ÷ source_bytes).
- The hero tile shows the overall write-amplification ratio; the chart plots source vs artifact MB per project; the table links each project to its detail page.

## Edge Cases
- API unavailable → inline `ErrorState` with retry (never a false "0 projects").
- No projects yet → empty states on cards, chart, and table.
- A project run in progress → its status badge animates; stats reflect whatever bytes are already archived.

## UX States
- Loading: "Loading archive metrics…" notice + skeleton cards/chart/table.
- Empty: "No reconstructions yet" / "No projects yet".
- Loaded: populated hero ratio, per-project bar chart, recent-projects table.

## Verification
- Test files: `services/api/tests/test_projects.py` (`test_dashboard_stats_aggregate_amplification`), `apps/web/src/lib/api-contract.test.ts`
- Required cases: aggregate ratio with archived projects, empty bucket, API error fallback
- Focused verify command: `pnpm test:api`
- Default pre-PR verify command: `pnpm verify`
- Full local verify command: `pnpm verify:full` when the E2E/live prerequisites in [Dev Workflows](../dev-workflows.md#commands) are available
- Pass criteria: focused tests and `pnpm verify` green; explain any skipped `pnpm verify:full` prerequisites

## Related Docs
- [Write amplification](write-amplification.md)
- [Projects](projects.md)
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [App Workflows](../app-workflows.md)
