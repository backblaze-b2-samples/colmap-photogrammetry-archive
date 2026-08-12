<!-- last_verified: 2026-08-06 -->
# Architecture

## Components

- **apps/web/** — Next.js 16 frontend (App Router, Tailwind v4, shadcn/ui)
  - Projects library + project detail (pipeline timeline, write-amplification panel, reconstruction stats, project-scoped asset explorer, downstream presigned-serving snippet)
  - Archive dashboard (projects, photos archived, source/artifact bytes, overall amplification ratio)
  - Full-bucket file browser and drag-and-drop Upload (doubles as project Ingest)
  - Dark mode via `next-themes`
- **services/api/** — FastAPI backend (layered architecture)
  - REST API for the Project lifecycle (create/read/update/delete/run), the scoped asset explorer, upload presign/verify, and the full-bucket file browser
  - COLMAP structure-from-motion via `pycolmap` (LAZY-imported in `repo/colmap_engine.py`), run in an isolated worker process (`service/colmap_worker.py`)
  - B2 S3 integration via boto3; per-project `manifest.json` as the artifact index (no database)
  - Health check, Prometheus-format metrics, structured JSON logging with request tracing
- **packages/shared/** — TypeScript type definitions
  - Mirrors Pydantic models from the API (Project, ArtifactEntry, WriteAmplification, …)
  - Consumed by `apps/web/` as workspace dependency

## Backend Layering

The API follows a strict layered architecture:

```
types/     Pydantic models — no logic, no imports from other layers
  |
config/    Settings (pydantic-settings) — depends only on types
  |
repo/      Data access (boto3 B2 client) — no business logic
  |
service/   Business logic — calls repo, returns types
  |
runtime/   FastAPI routes — calls service, never repo directly
```

### Layering Rules

1. Dependencies flow downward only: `types` -> `config` -> `repo` -> `service` -> `runtime`
2. No backward imports (e.g., service must not import from runtime)
3. `boto3` **and** `pycolmap` only allowed in `repo/` layer (`pycolmap` is additionally LAZY-imported inside `repo/colmap_engine.py` functions so nothing loads the native wheel at import time)
4. All boundary data uses Pydantic models (no raw dicts across layers)
5. Authored Python files under `services/api/app/` stay under 300 lines

### Directory Structure

```
services/api/
  main.py                  App entrypoint, middleware, router registration
  app/
    types/                 Pydantic models (projects.py, files.py, upload.py, …)
    config/                Settings loaded from environment
    repo/                  B2 S3 client + manifest/artifacts + colmap_engine (data access)
    service/               Business logic (projects, reconstruction_runner, colmap_worker, upload, files)
    runtime/               FastAPI route handlers (projects, files, upload, health, metrics)
  scripts/                 setup_b2_cors.py, export_openapi.py
  tests/                   pytest tests (structural + integration)
```

## Boundary Invariants

- **No external SDK leakage**: `boto3` is only imported in `app/repo/`. All other layers interact with B2 through the repo interface.
- **No raw dicts at boundaries**: All data crossing layer boundaries uses typed Pydantic models.
- **No cross-layer mutable state**: Configuration is read-only after init, and no mutable state is shared *between* layers. Intra-layer caches/counters (the listing cache in `repo/list_cache.py`, the B2 connectivity cache in `repo/b2_client.py`, the download counter in `repo/counter.py`, the rate-limit and metrics state in `runtime/`) are module-local and guarded by a `threading.Lock`. The listing cache also owns the only background thread in the app: a stale entry is served immediately while that thread re-scans (stale-while-revalidate), and `main.lifespan` warms it once at startup so no user pays for the cold full-bucket scan.
- **Validated inputs**: All HTTP inputs validated by FastAPI/Pydantic. File keys reject empty and path-traversal patterns; optional prefix confinement via `ALLOWED_KEY_PREFIX` (off by default).

## Deployment

- **Local dev** — `pnpm dev` runs both services via `concurrently`
  - Web: `localhost:3000`
  - API: `localhost:8000`
- **Railway** — two services from the same repository: `web` builds from the
  repository root because it consumes `packages/shared`; `api` builds from
  `services/api`. The versioned per-service configs and the human-approved
  staging/production contract live in [infra/railway/README.md](infra/railway/README.md).
- **Vercel** — one project using [Vercel Services](https://vercel.com/docs/services):
  the `web` (Next.js) and `api` (FastAPI) services build from the same repo and
  share one origin — the web app at `/`, the API under `/api`. The repo-root
  `vercel.json` declares both services and routes `/api/*` to the API service;
  the Vercel-only `services/api/index.py` strips the `/api` prefix so FastAPI
  keeps its native paths (`/health`, `/files`, …). Uploads go directly from the
  browser to B2 via a presigned PUT (see
  [File Upload](docs/features/file-upload.md)), so they bypass the Function's
  4.5 MB payload ceiling entirely — the bucket must allow the deploy origin in
  its CORS. A two-separate-Projects alternative and the full delivery contract
  live in [infra/vercel/README.md](infra/vercel/README.md).

External provisioning and deployment remain explicit user-approved actions.

## Data Stores

- **Backblaze B2** — object storage (S3-compatible API), the **sole** data store
  - Each project is a `projects/<slug>/manifest.json` object — the canonical index of the project's photos and derived artifacts. There is **no database**.
  - Project layout: `projects/<slug>/images/` (source photos), `projects/<slug>/database.db` (SIFT matches), `projects/<slug>/sparse/` (`points.ply`, `cameras.txt`, `images.txt`, `points3D.txt`), `projects/<slug>/dense/` (CUDA only), `projects/<slug>/manifest.json`.
  - Listing/metadata via S3 `list_objects_v2` / `head_object`; a scoped listing under `projects/<slug>/` drives the asset explorer and the write-amplification computation.

## External Services

- **Backblaze B2 S3 API** — file storage, retrieval, deletion, presigned URLs

## Trust Boundaries

See [docs/SECURITY.md](docs/SECURITY.md) for full security documentation.

- **Frontend -> API** — CORS-restricted to configured origins. `CORSMiddleware` is registered LAST in `main.py` (outermost) so it wraps **every** response, including uncaught-exception 500s — otherwise the browser would block error responses and the UI would only see an opaque "network error". See [docs/RELIABILITY.md](docs/RELIABILITY.md#error-handling). A per-IP rate-limit middleware sits inner to CORS; see [docs/SECURITY.md](docs/SECURITY.md#rate-limiting).
- **API -> B2** — authenticated via application keys, signature v4
- **Client -> B2** — presigned URLs for download (10-min expiry, forced attachment)

## Data Flows

- **Create project**: Browser -> `POST /projects` -> `service/projects.create_project` derives a unique slug and writes `projects/<slug>/manifest.json` to B2
- **Ingest**: Browser -> `POST /upload/presign` with `project_slug` (API signs a PUT to `projects/<slug>/images/`) -> Browser PUTs bytes **directly to B2** -> `POST /upload/verify`
- **Run reconstruction**: Browser -> `POST /projects/<slug>/run` -> `service/reconstruction_runner` marks the manifest queued, launches a background thread that downloads the project's photos, invokes the **isolated COLMAP worker** (`service/colmap_worker` -> `repo/colmap_engine`), streams stage progress into the manifest, uploads `database.db` + `sparse/` + `points.ply` back under the prefix, computes **write amplification**, and flips the manifest to `archived`. The UI polls `GET /projects/<slug>` while running.
- **Scoped explorer**: Browser -> `GET /projects/<slug>/artifacts` -> lists `projects/<slug>/` -> `GET /projects/<slug>/artifacts/download?key=…` presigns one artifact (confined to the project prefix)
- **Delete project**: Browser -> `DELETE /projects/<slug>` -> `repo/artifacts.delete_under` removes only `projects/<slug>/` (prefix-scoped; refuses a non-slash-terminated prefix)
- **Full-bucket browse/upload/download/delete**: unchanged from the starter (`/files`, `/upload`)

## Observability

- Structured JSON logging on all requests with `request_id`
- Request timing middleware (logs duration per request; also the catch-all that converts uncaught exceptions to a typed JSON 500)
- `/metrics` endpoint (Prometheus format: request count, latency, upload count)
- `/health` endpoint (B2 connectivity check)

## API Contract

- Checked-in OpenAPI artifact: `docs/api/openapi.json`
- Export/check command: `pnpm contract:export` / `pnpm contract:check`
- FastAPI freshness test: `services/api/tests/test_openapi_contract.py`
- Frontend route drift test: `apps/web/src/lib/api-contract.test.ts`

The frontend client keeps a small `API_CLIENT_ROUTES` registry in
`apps/web/src/lib/api-client.ts`. Tests compare that registry to the checked-in
OpenAPI artifact so route changes fail loudly before the hand-written client can
silently drift from FastAPI. `GET /metrics` is intentionally server-only.

## Canonical Files

- Project routes (runtime): `services/api/app/runtime/projects.py`
- Project lifecycle + dashboard aggregation: `services/api/app/service/projects.py`
- Reconstruction run path: `services/api/app/service/reconstruction_runner.py`
- Isolated COLMAP worker: `services/api/app/service/colmap_worker.py`
- COLMAP engine (all `pycolmap`, lazy): `services/api/app/repo/colmap_engine.py`
- Manifest + scoped artifacts (repo): `services/api/app/repo/manifest.py`, `repo/artifacts.py`
- B2 S3 client (repo): `services/api/app/repo/b2_client.py`
- Pydantic models: `services/api/app/types/` (`projects.py`, `files.py`, `upload.py`, …)
- Config (pydantic-settings): `services/api/app/config/settings.py`
- Structural tests: `services/api/tests/test_structure.py`
- OpenAPI contract: `docs/api/openapi.json`
- Frontend API client: `apps/web/src/lib/api-client.ts`
- Shared TypeScript types: `packages/shared/src/types.ts`

## Core Features

- [Projects](docs/features/projects.md)
- [Reconstruction pipeline](docs/features/reconstruction-pipeline.md)
- [Write amplification](docs/features/write-amplification.md)
- [File Upload](docs/features/file-upload.md)
- [File Browser](docs/features/file-browser.md)
- [Dashboard](docs/features/dashboard.md)
- [Metadata Extraction](docs/features/metadata-extraction.md)

## References

- [docs/SECURITY.md](docs/SECURITY.md) — security principles and implementation
- [docs/RELIABILITY.md](docs/RELIABILITY.md) — reliability expectations
- [AGENTS.md](AGENTS.md) — architectural invariants and agent instructions
