<!-- last_verified: 2026-08-06 -->
# Feature: Reconstruction pipeline

## Purpose
Run **real COLMAP structure-from-motion** over a project's photos via the
official `pycolmap` bindings — SIFT feature extraction, feature matching,
incremental mapping into a sparse point cloud with camera poses — and archive the
derived artifacts on B2. This is the marquee local workload.

## Used By
- UI: the "Run reconstruction" button + pipeline timeline on `/projects/[slug]`
- API: `POST /projects/{slug}/run`, polled via `GET /projects/{slug}`

## Core Functions
- `services/api/app/repo/colmap_engine.py` — **ALL** `pycolmap` calls, LAZY-imported inside functions. `run_reconstruction()` does extract → match → incremental map → export the sparse model + `points.ply`; `detect_device()` auto-detects the compute device.
- `services/api/app/service/colmap_worker.py` — runs the engine in an **isolated 'spawn' process** with a bounded timeout, streaming stage snapshots back over a pipe.
- `services/api/app/service/reconstruction_runner.py` — the run orchestration: download photos from B2 → invoke the isolated worker → upload `database.db` + `sparse/` + `points.ply` → compute write amplification → persist the manifest.

## Device policy (`deployment: local`)
Auto-detect order is **CUDA → CPU**, with CPU the safe default (never a hard GPU
requirement). Apple MPS is not applicable to COLMAP's C++/CUDA kernels, so on
Apple Silicon the pipeline runs on CPU.
- **Sparse SfM** (SIFT extraction with `use_gpu=False`, matching, incremental mapping) **always runs on CPU** — the marquee workload, `$0` on-device.
- **Dense MVS** (patch-match stereo + fusion) is **CUDA-only** and auto-gated: attempted only when a CUDA device is detected, otherwise recorded as a clean `skipped` stage ("CUDA required") and the sparse model is archived for downstream GPU jobs. `GET /projects/capabilities` surfaces `dense_available` so the form disables the dense toggle when no GPU is present.

## Matcher modes
`matcher` selects the COLMAP matcher: `sequential` (ordered photo/video frames),
`exhaustive` (unordered sets), or `spatial` (geotagged photos). The engine
dispatches to the matcher COLMAP exposes and falls back to exhaustive.

## Crash isolation
A native abort/segfault inside COLMAP's C++ kernels can't be caught by a Python
`try/except` and can't be reclaimed by a thread-level timeout. So the engine runs
in a **separate process**: a native crash kills only the child (surfaced as a
`failed` project with a clear message), and a genuine hang is bounded by killing
the child at `PROJECT_RUN_TIMEOUT_SECONDS`. Only picklable data crosses the
boundary (photo bytes in, artifact bytes + stats out); B2 I/O stays in the
parent, so the child imports no `boto3`.

## Stages (persisted to the manifest for live polling)
`ingest → extracting → matching → sparse → dense (CUDA-gated) → archived`. Each
transition writes the stage list + coarse status back to `manifest.json`, so the
detail-page timeline advances live while the run is still in progress.

## Inputs / Outputs
- Input: the project's source photos (`projects/<slug>/images/`, or a custom `source_prefix`), quality/matcher/dense settings from the manifest.
- Output artifacts under `projects/<slug>/`: `database.db`, `sparse/points.ply`, `sparse/cameras.txt`, `sparse/images.txt`, `sparse/points3D.txt`. Stats: images_found, images_registered, sparse_points, mean_reproj_error, dense_points (or null on CPU), device.

## Edge Cases
- Fewer than 3 overlapping photos, or COLMAP registers no model → the run fails with an actionable message ("capture more overlapping views with steady parallax").
- `pycolmap` version drift → optional kwargs are dropped defensively (`_safe_call`) so the engine survives minor API changes.
- Project deleted mid-run → the run detects the missing manifest and exits without writing.
- Concurrent run requests for the same project → the second gets 409 (module-local run guard).

## Verification
- Test files: `services/api/tests/test_structure.py` (`test_pycolmap_only_in_repo`, layering, 300-line limit), `services/api/tests/test_projects.py`
- Required cases: pycolmap confined to `repo/` and lazy-imported (the app, tests, and OpenAPI export all import without the wheel); run guard; prefix-scoped artifact writes
- Focused verify command: `pnpm check:structure`
- Default pre-PR verify command: `pnpm verify`
- Full local verify command: `pnpm verify:full` when the E2E/live prerequisites in [Dev Workflows](../dev-workflows.md#commands) are available
- Pass criteria: focused tests and `pnpm verify` green; explain any skipped `pnpm verify:full` prerequisites

## Related Docs
- [Projects](projects.md)
- [Write amplification](write-amplification.md)
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
