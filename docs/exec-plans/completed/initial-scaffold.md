# Build plan — `colmap-photogrammetry-archive`

## 1. Purpose

`colmap-photogrammetry-archive` is a full-stack B2 sample for photogrammetry
studios, film-VFX teams, and cultural-heritage digitization projects that run
**structure-from-motion (SfM)** over large overlapping photo sets and need a
durable **archive** for every input and derived 3D artifact. A team creates a
**Project** (a scene), ingests overlapping photos into the project's B2 prefix,
runs **COLMAP** locally (via the official `pycolmap` bindings) to recover camera
poses and a sparse point cloud — and, when a CUDA GPU is present, a dense point
cloud — then archives the source images, the SIFT match **database**, the
**sparse** model, the **dense** artifacts, and a per-project **manifest JSON**
on **Backblaze B2** over the S3-compatible API. The headline this sample
demonstrates is **write amplification**: a photo set fans out into
database + sparse + dense + point-cloud artifacts whose total footprint meets or
exceeds the source bytes, and B2 is the single storage layer that holds all of
it and serves it back to downstream NeRF / 3DGS jobs via presigned URLs.

Runs on local OSS only — COLMAP is keyless. The **only** secret is B2
credentials (no second API key).

### Distinctness from the sibling `colmap-gaussian-splatting-pipeline`

Both use `pycolmap` on CPU, but they are different products and this one is
built **from the starter kit**, not from the sibling:

| | sibling `colmap-gaussian-splatting-pipeline` | this `colmap-photogrammetry-archive` |
|---|---|---|
| Primary entity | **Capture** | **Project** (archive scene) |
| Headline | Nerfstudio/gsplat-ready **bundle** (`transforms.json`) for 3DGS training | **Write amplification** — source bytes vs derived-artifact bytes + ratio |
| B2 framing | stage a training bundle | **archive** the full artifact lifecycle + a **manifest JSON as the artifact index**; presigned serving for downstream jobs |
| Distinct UI | sparse-cloud preview + `ns-train` command | **write-amplification panel** + **project-scoped asset explorer** over the manifest |

Do not copy the sibling. Build the delta below on top of the fresh starter clone.

## 2. Architecture delta from `vibe-coding-starter-kit`

Source of truth: `.claude/scratch/vcsk-abcd7c2d-f95b-4e27-9d7b-186ae8fedb1f/`.
The starter is the ceiling — strip what this app doesn't need, keep the B2
scaffolding, add the photogrammetry-archive layer.

### KEEP (as-is — starter contract, do not strip/rename)
- **UI kit** `apps/web/src/components/ui/` (shadcn primitives), design tokens in
  `apps/web/src/app/globals.css`, and the `/design` reference page.
- **Full-bucket File Explorer** — `/files` route, `apps/web/src/app/files/`,
  `apps/web/src/components/files/`, and its sidebar entry. **Non-negotiable
  keep** (the bucket explorer is never removable). It complements the new
  project-scoped explorer: Files browses the *entire* bucket; the project
  explorer scopes to one project's prefix.
- **Upload** — `/upload` route, `apps/web/src/app/upload/`,
  `apps/web/src/components/upload/`, and its sidebar entry. This is the **Ingest**
  step (drag-and-drop photos → presigned PUT → B2). Add a small extension so an
  upload can target a chosen project prefix (`projects/<slug>/images/`), keeping
  the default un-prefixed path working.
- **Layered FastAPI backend** — `types → config → repo → service → runtime`,
  structural tests, health/metrics/ratelimit runtime, the B2 repo
  (`repo/b2_client.py`, `repo/list_cache.py`, `repo/b2_object.py`,
  `repo/b2_upload.py`, `repo/counter.py`), and the OpenAPI contract machinery.
- **Presigned upload/download flow**, CORS/rate-limit middleware, sidebar nav
  shell, TanStack-Query data layer, `pnpm verify` gate suite, agent docs.

### TRIM (remove from starter — not needed here)
- **Nothing removed outright.** The dashboard is *rewritten* (see ADD), not
  stripped. `docs/features/metadata-extraction.md` is **repurposed** to "image
  metadata on ingest" (dimensions/EXIF of uploaded photos still matters), not
  deleted. `recent-uploads-table` / `upload-chart` / `stats-cards` dashboard
  components are replaced with project-oriented equivalents rather than kept as
  generic file widgets.

### ADD (new for `colmap-photogrammetry-archive`)
Backend (`services/api/app/`, every authored file < 300 lines, boto3/pycolmap
only in `repo/`, all heavy wheels **lazy-imported inside repo functions**):
- `types/projects.py` — `ProjectStatus` (enum: `draft` → `queued` → `extracting`
  → `matching` → `sparse` → `dense` → `archived` → `failed`), `MatcherMode`
  (enum: `exhaustive|sequential|spatial`), `FeatureQuality` (enum:
  `low|medium|high`), `ProjectCreate`, `ProjectUpdate`, `Project`,
  `ReconstructionStats` (images_found, images_registered, sparse_points,
  mean_reproj_error, dense_points|None), `ArtifactEntry` (key, kind, size_bytes,
  size_human), `WriteAmplification` (source_bytes, artifact_bytes, ratio),
  `PipelineStage` (name, status, detail).
- `repo/manifest.py` — read/write the per-project manifest at
  `projects/<slug>/manifest.json` on B2 (`get_object`/`put_object`); list all
  projects by scanning `projects/` for `*/manifest.json`. **B2 is the sole store
  for projects — no database** (consistent with the starter). Manifest is the
  canonical artifact index.
- `repo/artifacts.py` — project-**scoped** listing/stat under
  `projects/<slug>/` (reuses the list-cache pattern), presign helpers for
  project artifacts, and a scoped delete (`delete_objects` over the prefix).
- `repo/colmap_engine.py` — **ALL** `pycolmap` calls, lazy-imported. Runs the SfM
  in an **isolated worker subprocess** (native COLMAP can segfault; a crash must
  not wedge the API — mirrors the sibling's proven pattern and the repo's
  native-ML crash-containment guidance). CPU by default; **auto-detect GPU:
  CUDA → (MPS unsupported by COLMAP → treated as CPU, noted) → CPU**. SIFT
  extraction + matching (mode per `MatcherMode`) + incremental mapping (sparse)
  always run on CPU; export sparse `points.ply`. **Dense MVS (patch-match stereo
  + fusion) is CUDA-only** — gated: run when CUDA present, otherwise skip with a
  clear "CUDA required" stage note.
- `service/projects.py` — CRUD orchestration over `repo/manifest` +
  `repo/artifacts` (list/create/get/update/delete; delete is **scoped to the
  project prefix only** — never a bucket-wide wipe).
- `service/reconstruction_runner.py` — background run orchestration: download the
  project's images from B2 → invoke `repo/colmap_engine` → upload
  `database.db`, `sparse/`, `points.ply`, and (if CUDA) `dense/` back under the
  project prefix → compute **write amplification** (artifact_bytes /
  source_bytes) → write the manifest with final stats. Status transitions are
  persisted to the manifest so the UI can poll. Uses a background task + a
  module-local in-progress guard (one run per project at a time).
- `runtime/projects.py` — REST routes (all re-exported to
  `docs/api/openapi.json`): `GET /projects`, `POST /projects`,
  `GET /projects/{slug}`, `PATCH /projects/{slug}`, `DELETE /projects/{slug}`,
  `POST /projects/{slug}/run`, `GET /projects/{slug}/artifacts` (scoped
  explorer), `GET /projects/{slug}/artifacts/download` (presign a scoped
  artifact). No business logic in the handler — delegates to `service/`.

Frontend (`apps/web/src/`):
- **Projects library** — `/projects` route + `app/projects/page.tsx` +
  `components/projects/`. Cards per project: name, status badge, images
  archived, images registered, sparse points, source→artifact bytes and the
  **amplification ratio**. "New Project" primary action.
- **Project detail** — `/projects/[slug]` route. Contains:
  - **Pipeline stage timeline** (Ingest → Extract → Match → Sparse →
    Dense[CUDA-gated] → Manifest/Archived), current status, per-stage detail.
  - **Write-amplification panel** — source bytes vs artifact bytes with the
    ratio prominently displayed (the sample's headline metric).
  - **Reconstruction stats** — images registered, sparse points, mean reproj
    error, dense points (or "CUDA required").
  - **Project-scoped asset explorer** (the required sample-specific scoped
    explorer) — the artifact tree read from the manifest: `images/`,
    `database.db`, `sparse/`, `points.ply`, `dense/`, `manifest.json`, each with
    size + a download (presigned) action.
  - **Downstream-usage snippet** — a copyable presigned-pull example showing how
    a NeRF/3DGS job fetches images + sparse model from B2.
  - **Run** / **Edit** / **Delete** actions.
- **New/Edit Project forms** — `components/projects/project-form.tsx`, modeled on
  the starter's `settings/settings-form.tsx` (react-hook-form + shadcn `Form`).
- **Dashboard rewrite** — `/` + `components/dashboard/`: stat cards (Projects,
  Images archived, Source bytes on B2, Artifact bytes on B2, **overall
  write-amplification ratio** as the hero tile), a chart (source vs artifact
  bytes per project — the amplification story), and a **recent-projects** table.
  All aggregations flow through `runtime → service → repo` and TanStack-Query
  hooks in `lib/queries.ts` (no bare `useEffect + fetch`).
- **Sidebar** — add a **Projects** entry (`FolderKanban`/`Boxes` icon) above
  Files. Keep Dashboard, Upload, Files, Settings, and the Design System link.
- `lib/queries.ts` — hooks for every project endpoint; `lib/api-client.ts` —
  register the new routes in `API_CLIENT_ROUTES`; `packages/shared/src/types.ts`
  — mirror the new Pydantic models.
- `lib/app-config.ts` — `APP_NAME = "COLMAP Photogrammetry Archive"`.

Scripts / infra:
- `scripts/seed_demo_project.py` — optional convenience: fetch a **small,
  explicitly CC0 / public-domain** multi-view photo set from a stable URL into
  `projects/demo-scene/images/` and create the project, so a fresh clone has
  something to Run. **No imagery is committed to the repo** (keeps the repo clear
  of any third-party data-redistribution question); the seed source must be
  CC0/PD and is documented in the README with its provenance. The primary demo
  path is "upload your own overlapping photos to a project, then Run."

## 3. B2 surface (S3-compatible only — no b2-native)

| Operation | Where | Purpose |
|---|---|---|
| `put_object` | `repo/manifest`, `repo/colmap_engine` upload path | manifest.json + every derived artifact |
| `list_objects_v2` | `repo/list_cache` (full bucket) + `repo/artifacts` (scoped prefix) | Files explorer + project asset explorer + stats |
| `head_object` | `repo/artifacts`, `repo/b2_client` | artifact sizes/metadata |
| `get_object` | `repo/colmap_engine` download path, `repo/manifest` | pull images to a temp dir for COLMAP; read manifest |
| `delete_object` / `delete_objects` | `repo/artifacts` scoped delete | scoped project deletion (prefix only) |
| `generate_presigned_url` | `repo/b2_client`, `repo/artifacts` | GET for download/serving, PUT for ingest |

Custom user agent `user_agent_extra="b2ai-colmap-photogrammetry-archive"` on the
single S3 client. **No b2-native API anywhere.** Standardized `B2_*` env vars
(section 6). This satisfies all three `/b2-doctor` standards.

## 4. Key features (seed README + `docs/features/*`)

1. **Ingest to B2** — drag-and-drop overlapping photos straight to a project's
   B2 prefix via presigned PUT (starter Upload, extended with a project target).
   *Local feature, no external provider.*
2. **COLMAP reconstruction (local, CPU-default / GPU-autodetect)** — SIFT
   extraction, feature matching (exhaustive/sequential/spatial), incremental
   sparse mapping, and CUDA-gated dense MVS, via `pycolmap` in an isolated worker.
   **`deployment: local`** — CPU default, auto-detect CUDA → (MPS unsupported →
   CPU) → CPU; dense stage CUDA-only. No external API, **no key beyond B2**,
   est. cost per run **$0** (on-device).
3. **Write-amplification archive** — every artifact (source images, match DB,
   sparse model, dense cloud, meshes, manifest) versioned under the project
   prefix; the app surfaces source-vs-artifact bytes and the amplification ratio.
4. **Per-project manifest as artifact index** — `manifest.json` records all
   artifact paths + sizes + reconstruction stats + status; it drives the scoped
   asset explorer and the downstream presigned-serving story.
5. **Downstream presigned serving** — a copyable example of a NeRF/3DGS job
   pulling images + sparse model directly from B2 via presigned URLs.

### External API provider
**None.** This is a purely-local sample: the heavy workload (COLMAP) runs
on-device via `pycolmap`. Per `api-provider-selection.md`, a purely-local
feature is `deployment: local` and inherits the CPU-default / GPU-autodetect
hard rule (CUDA → MPS → CPU; MPS unsupported by COLMAP, noted). No provider key,
no Genblaze (the description names no Genblaze/AI-provider stack — trending OSS
is COLMAP only). Only secret = B2 credentials.

- Feature 1 (Ingest): `deployment: local` (browser→B2), cost $0.
- Feature 2 (Reconstruction): `deployment: local`, engine `pycolmap`, cost $0.
- Features 3–5 (archive/manifest/serving): `deployment: local`, B2-only, cost $0.

### Primary-entity lifecycle (UI completeness)
**Primary entity: `Project`** (a photogrammetry archive scene). All five
lifecycle verbs are exposed in the UI and built in Phase 2:
- **create** — "New Project" form (`/projects`, `project-form.tsx`).
- **read** — Projects library + Project detail + scoped asset explorer.
- **edit** — "Edit" form on project detail (name, matcher, quality, dense
  toggle); pre-filled from the manifest.
- **delete** — "Delete" with a shadcn `AlertDialog` confirm; scoped B2 prefix
  cleanup only.
- **run** — "Run reconstruction" button → background COLMAP pipeline.

**`omitted_ui_verbs`: none** — every verb the app supports is in the UI.

### Form UX conventions (create/edit)
Finite-value fields use selectors (never free text), on **both** create and edit:
- `matcher` → `Select` (exhaustive / sequential / spatial).
- `quality` → `Select` or `RadioGroup` (low / medium / high feature budget).
- `max_image_dim` → `Select` (e.g. 1024 / 1600 / 2048 / original).
- `enable_dense` → `Switch`, **disabled/gated** with a "CUDA required" hint when
  no GPU is detected.
- Free-text only for `name` and the optional source `prefix`.

CREATE form supplies safe defaults as placeholder / `FormDescription` guidance
(guidance only, never an autofill button): matcher = `sequential` for ordered
photo/video frames (with a note to pick `exhaustive` for unordered sets),
quality = `medium`, max_image_dim = `1600`, dense = off. EDIT form opens
pre-filled from the project's real settings. Model both on the starter's
`settings/settings-form.tsx`.

## 5. Doc transforms

- `docs/features/dashboard.md` — **rewrite** to the archive dashboard (projects,
  images archived, source/artifact bytes, amplification ratio, recent projects).
- `docs/features/file-browser.md` — **keep** (full-bucket explorer unchanged).
- `docs/features/file-upload.md` — **keep**, add the project-target note (Ingest).
- `docs/features/metadata-extraction.md` — **repurpose** to image metadata on
  ingest (dimensions/EXIF of uploaded photos).
- `docs/features/settings.md` — **keep** (trim to what remains).
- **New** `docs/features/projects.md` — Project lifecycle (create/read/edit/
  delete/run) + the scoped asset explorer.
- **New** `docs/features/reconstruction-pipeline.md` — COLMAP stages, matcher
  modes, CPU-default / CUDA-gated dense, isolated-worker crash isolation.
- **New** `docs/features/write-amplification.md` — the headline metric: how it's
  computed and why B2 is the storage layer for the fan-out.
- Update `ARCHITECTURE.md` (new routes/layers/data flows, B2-as-project-store),
  `README.md` (purpose, quick start, features, env), `docs/app-workflows.md`
  (the ingest→reconstruct→archive→serve journey), and `AGENTS.md` doc-map/branding
  as needed. Re-export `docs/api/openapi.json` for the new routes.

## 6. Rename table

| Identifier | From | To |
|---|---|---|
| Repo / dir | `vibe-coding-starter-kit` | `colmap-photogrammetry-archive` |
| Display name (`app-config.ts` `APP_NAME`) | `Vibe Coding Starter Kit` | `COLMAP Photogrammetry Archive` |
| `APP_DESCRIPTION` | file mgmt template | `Structure-from-motion photogrammetry archive on Backblaze B2` |
| Root `package.json` name | `vibe-coding-starter-kit` | `colmap-photogrammetry-archive` |
| `apps/web` pkg name | `@vibe-coding-starter-kit/web` (or starter's) | `@colmap-photogrammetry-archive/web` |
| `packages/shared` pkg name | starter's | `@colmap-photogrammetry-archive/shared` |
| B2 attribution token — `user_agent_extra` **and** README `utm_content` | `b2ai-oss-start` | `b2ai-colmap-photogrammetry-archive` |
| FastAPI `API_TITLE`/description | derived from `APP_NAME` | derived from `APP_NAME` (keep the branding derivation) |
| Vercel/CI workflow slugs, image tags | starter slug | `colmap-photogrammetry-archive` |

### B2 env-var contract (Standard #3 — rename from the starter's deviation)
The starter's `.env.example`/`settings.py` use the **deviating** `B2_KEY_ID` /
`B2_ENDPOINT` / `B2_PUBLIC_URL` with no `B2_REGION`. Rename to the standardized
contract (matches the current sibling convention):
- `B2_APPLICATION_KEY_ID` (`settings.b2_application_key_id`)
- `B2_APPLICATION_KEY` (`settings.b2_application_key`)
- `B2_BUCKET_NAME` (`settings.b2_bucket_name`)
- `B2_REGION` (`settings.b2_region`) — endpoint derived as
  `https://s3.<region>.backblazeb2.com` via an `endpoint_url` property; optional
  `B2_ENDPOINT` advanced override.
- `B2_PUBLIC_URL_BASE` (`settings.b2_public_url_base`, optional).

Update `settings.py`, `.env.example`, `repo/b2_client.py` (client ctor + public
URL), `scripts/setup_b2_cors.py`, `live_tests/`, and any docs referencing the
old names. Keep `NEXT_PUBLIC_API_URL` as-is.

## Verification bar for Phase 2 (builder must leave green)
- `pnpm run setup` then `pnpm verify` (agent-docs + api + web) green from a clean
  venv; `pnpm build` succeeds; `pnpm contract:check` passes (openapi + client
  routes in sync). Structural tests pass (layering, boto3-only-in-repo,
  <300-line files, pycolmap not imported outside `repo/`).
- pycolmap pinned (`pycolmap>=3.10,<3.12`, `numpy<2`, plus `plyfile`, `imageio`,
  `imageio-ffmpeg`, `Pillow`), lazy-imported in `repo/` so import/collection/
  contract-export work even where the wheel is absent. requirements.lock
  regenerated.
- All five `Project` verbs reachable in the UI; finite-value form fields use
  selectors; create form has default hints; delete is prefix-scoped.
- Full-bucket Files explorer retained; project-scoped asset explorer added.
- Custom user agent + Standard #3 B2 env names present.
