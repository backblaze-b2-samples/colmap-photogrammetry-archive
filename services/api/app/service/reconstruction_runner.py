"""Run path for a Project: launch COLMAP and archive its artifacts to B2.

Split out of ``service/projects.py`` to keep each module under the 300-line
structural ceiling. Reuses that module's B2-backed manifest store and the shared
in-process run guard, and owns the heavy side of a run: downloading the project's
source photos, invoking the isolated COLMAP worker, and writing the match
``database.db``, sparse model, and ``points.ply`` (plus ``dense/`` when CUDA is
present) back under the project's own prefix — then computing write amplification
and persisting the final manifest. The compute itself runs in a SEPARATE process
(``service/colmap_worker.py``) so a native COLMAP crash/hang can't wedge the API.
"""

import logging
import threading
import time
from datetime import UTC, datetime

from app.config import settings
from app.repo import artifacts, manifest
from app.repo.colmap_engine import ColmapResult, detect_device
from app.service.colmap_worker import (
    ReconstructionCrashed,
    ReconstructionError,
    ReconstructionTimeout,
    run_reconstruction_isolated,
)
from app.service.projects import (
    ProjectNotFoundError,
    ProjectValidationError,
    _amplification_from_objs,
    _run_lock,
    _running,
    get_project,
)
from app.types.formatting import humanize_bytes
from app.types.projects import (
    ArtifactEntry,
    PipelineStage,
    Project,
    ProjectStatus,
    ReconstructionStats,
)

logger = logging.getLogger(__name__)

_IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
# Map a COLMAP stage name to the coarse Project status persisted for polling.
_STAGE_TO_STATUS = {
    "extracting": ProjectStatus.extracting,
    "matching": ProjectStatus.matching,
    "sparse": ProjectStatus.sparse,
    "dense": ProjectStatus.dense,
}


def _now() -> datetime:
    return datetime.now(UTC)


def _effective_prefix(project: Project) -> str:
    return project.source_prefix or manifest.images_prefix(project.slug)


def run_project(slug: str) -> Project:
    """Mark a project queued and launch COLMAP in a background thread."""
    project = get_project(slug)
    images = _load_images(project)
    if len(images) < 3:
        raise ProjectValidationError(
            "Add at least 3 overlapping photos to this project before running."
        )
    with _run_lock:
        if project.status in _STAGE_TO_STATUS.values() or slug in _running:
            from app.service.projects import ProjectConflictError

            raise ProjectConflictError()
        _running.add(slug)
    now = _now()
    started = project.model_copy(
        update={
            "status": ProjectStatus.queued,
            "error": None,
            "started_at": now,
            "updated_at": now,
        }
    )
    manifest.save(started)
    threading.Thread(target=_execute, args=(slug, images), daemon=True).start()
    logger.info("Project run started: slug=%s images=%d", slug, len(images))
    return started


def _load_images(project: Project) -> list[tuple[str, bytes]]:
    """Download the project's source photos from B2 into memory."""
    out: list[tuple[str, bytes]] = []
    for obj in artifacts.list_under(_effective_prefix(project)):
        name = obj["Key"].rsplit("/", 1)[-1]
        if not name.lower().endswith(_IMAGE_EXTS):
            continue
        data = artifacts.get_bytes(obj["Key"])
        if data is not None:
            out.append((name, data))
    return out


def _execute(slug: str, images: list[tuple[str, bytes]]) -> None:
    try:
        project = manifest.load(slug)
        if project is None:  # deleted between run_project() and here
            return

        def _persist(snapshot: list[dict]) -> None:
            live = manifest.load(slug)
            if live is None:  # deleted mid-run
                return
            stages = [PipelineStage.model_validate(s) for s in snapshot]
            status = _current_status(snapshot)
            manifest.save(
                live.model_copy(update={"stages": stages, "status": status, "updated_at": _now()})
            )

        started_at = time.monotonic()
        result = run_reconstruction_isolated(
            images,
            quality=project.quality.value,
            matcher=project.matcher.value,
            enable_dense=project.enable_dense,
            device=detect_device(),
            timeout=settings.project_run_timeout_seconds,
            on_progress=_persist,
        )
        elapsed = time.monotonic() - started_at
        _archive_result(slug, result, round(elapsed, 1))
        logger.info(
            "Project archived: slug=%s registered=%s points=%s",
            slug,
            result.images_registered,
            result.sparse_points,
        )
    except ReconstructionTimeout:
        _mark_failed(slug, "Reconstruction exceeded the per-run time limit")
    except ReconstructionCrashed as exc:
        logger.warning("Project worker crashed: slug=%s err=%s", slug, exc)
        _mark_failed(slug, "Reconstruction failed unexpectedly (worker crashed)")
    except ReconstructionError as exc:
        _mark_failed(slug, str(exc))
    except (ProjectNotFoundError, ProjectValidationError) as exc:
        _mark_failed(slug, getattr(exc, "detail", str(exc)))
    except Exception as exc:  # contain any failure on the manifest, never crash
        logger.warning("Project run failed: slug=%s err=%s", slug, exc)
        _mark_failed(slug, str(exc))
    finally:
        with _run_lock:
            _running.discard(slug)


def _current_status(snapshot: list[dict]) -> ProjectStatus:
    """The coarse status for the latest running/pending stage in a snapshot."""
    for stage in snapshot:
        if stage["status"] == "running" and stage["name"] in _STAGE_TO_STATUS:
            return _STAGE_TO_STATUS[stage["name"]]
    return ProjectStatus.extracting


def _archive_result(slug: str, result: ColmapResult, elapsed: float) -> None:
    prefix = manifest.project_prefix(slug)
    entries: list[ArtifactEntry] = []

    def emit(kind: str, key: str, data: bytes, ctype: str) -> None:
        if not data:
            return
        size = artifacts.put_bytes(key, data, ctype)
        entries.append(
            ArtifactEntry(key=key, kind=kind, size_bytes=size, size_human=humanize_bytes(size))
        )

    emit("database", f"{prefix}database.db", result.database_db, "application/octet-stream")
    emit("points", f"{prefix}sparse/points.ply", result.points_ply, "application/octet-stream")
    emit("sparse", f"{prefix}sparse/cameras.txt", result.cameras_txt, "text/plain")
    emit("sparse", f"{prefix}sparse/images.txt", result.images_txt, "text/plain")
    emit("sparse", f"{prefix}sparse/points3D.txt", result.points3d_txt, "text/plain")
    # Dense cloud only exists when dense MVS ran (CUDA); empty on CPU.
    emit("dense", f"{prefix}dense/fused.ply", result.dense_ply, "application/octet-stream")

    live = manifest.load(slug)
    if live is None:  # deleted mid-run
        return
    objs = artifacts.list_under(prefix)
    amp = _amplification_from_objs(live, objs)
    stats = ReconstructionStats(
        images_found=result.images_found,
        images_registered=result.images_registered,
        sparse_points=result.sparse_points,
        mean_reproj_error=result.mean_reproj_error,
        dense_points=result.dense_points,
    )
    stages = [PipelineStage.model_validate(s) for s in result.stages]
    manifest.save(
        live.model_copy(
            update={
                "status": ProjectStatus.archived,
                "updated_at": _now(),
                "device": result.device,
                "duration_seconds": elapsed,
                "stats": stats,
                "stages": stages,
                "artifacts": entries,
                "write_amplification": amp,
            }
        )
    )


def _mark_failed(slug: str, detail: str) -> None:
    live = manifest.load(slug)
    if live is None:
        return
    manifest.save(
        live.model_copy(
            update={
                "status": ProjectStatus.failed,
                "error": detail,
                "updated_at": _now(),
            }
        )
    )
