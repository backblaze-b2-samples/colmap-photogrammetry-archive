"""Project lifecycle: create / read / update / delete + dashboard aggregation.

A Project's system of record is a JSON manifest in B2
(``projects/<slug>/manifest.json``) — no database. Deletes are scoped to the
project's own prefix (never a bucket-wide wipe). The heavy run path lives in
``service/reconstruction_runner.py``; the shared in-process run guard
(``_run_lock`` / ``_running``) is defined here and imported there.
"""

import logging
import re
import threading
import uuid
from datetime import UTC, datetime

from app.repo import artifacts, manifest
from app.repo.colmap_engine import detect_device
from app.types.formatting import humanize_bytes
from app.types.projects import (
    Project,
    ProjectCreate,
    ProjectStats,
    ProjectStatus,
    ProjectUpdate,
    ReconstructionStats,
    ServerCapabilities,
    WriteAmplification,
)

logger = logging.getLogger(__name__)

# Shared with service/reconstruction_runner.py, which owns the run/execute path.
# A module-level lock + set is the single-replica in-process guard so two
# concurrent POST /run requests can't both launch the same project.
_run_lock = threading.Lock()
_running: set[str] = set()

_SLUG_RE = re.compile(r"[^a-z0-9]+")


class ProjectNotFoundError(Exception):
    def __init__(self, detail: str = "Project not found"):
        self.detail = detail
        super().__init__(detail)


class ProjectConflictError(Exception):
    def __init__(self, detail: str = "Project is already running"):
        self.detail = detail
        super().__init__(detail)


class ProjectValidationError(Exception):
    def __init__(self, detail: str = "Invalid project"):
        self.detail = detail
        super().__init__(detail)


def _now() -> datetime:
    return datetime.now(UTC)


def _slugify(name: str) -> str:
    base = _SLUG_RE.sub("-", name.strip().lower()).strip("-")
    return base or "project"


def _unique_slug(name: str) -> str:
    base = _slugify(name)[:48]
    if not manifest.exists(base):
        return base
    return f"{base}-{uuid.uuid4().hex[:6]}"


def _is_manifest(key: str) -> bool:
    return key.endswith(f"/{manifest.MANIFEST_NAME}")


def _amplification_from_objs(project: Project, objs: list[dict]) -> WriteAmplification:
    """Compute write amplification for a project from its own object list.

    Source = photos under images/. Artifacts = everything else under the project
    prefix except the manifest. When a custom ``source_prefix`` is set the source
    photos live outside the project prefix, so the stored source bytes (measured
    at run time) are used instead.
    """
    img_prefix = manifest.images_prefix(project.slug)
    source_bytes = sum(o["Size"] for o in objs if o["Key"].startswith(img_prefix))
    artifact_bytes = sum(
        o["Size"]
        for o in objs
        if not o["Key"].startswith(img_prefix) and not _is_manifest(o["Key"])
    )
    if project.source_prefix:
        source_bytes = project.write_amplification.source_bytes or source_bytes
    ratio = round(artifact_bytes / source_bytes, 3) if source_bytes else 0.0
    return WriteAmplification(
        source_bytes=source_bytes,
        source_bytes_human=humanize_bytes(source_bytes),
        artifact_bytes=artifact_bytes,
        artifact_bytes_human=humanize_bytes(artifact_bytes),
        ratio=ratio,
    )


def _overlay_live(project: Project, objs: list[dict]) -> Project:
    """Overlay live image counts + write amplification onto a stored manifest."""
    img_prefix = manifest.images_prefix(project.slug)
    images = [o for o in objs if o["Key"].startswith(img_prefix)]
    images_archived = len(images) if not project.source_prefix else project.images_archived
    return project.model_copy(
        update={
            "images_archived": images_archived,
            "write_amplification": _amplification_from_objs(project, objs),
        }
    )


def _objs_by_slug(all_objs: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    prefix_len = len(manifest.PROJECTS_PREFIX)
    for obj in all_objs:
        rest = obj["Key"][prefix_len:]
        slug = rest.split("/", 1)[0]
        if slug:
            grouped.setdefault(slug, []).append(obj)
    return grouped


def list_projects() -> list[Project]:
    """Every project, newest first, with live image/amplification overlays."""
    all_objs = artifacts.list_under(manifest.PROJECTS_PREFIX)
    grouped = _objs_by_slug(all_objs)
    out: list[Project] = []
    for project in manifest.list_all():
        out.append(_overlay_live(project, grouped.get(project.slug, [])))
    return out


def get_project(slug: str) -> Project:
    project = manifest.load(slug)
    if project is None:
        raise ProjectNotFoundError()
    objs = artifacts.list_under(manifest.project_prefix(slug))
    return _overlay_live(project, objs)


def create_project(payload: ProjectCreate) -> Project:
    now = _now()
    project = Project(
        slug=_unique_slug(payload.name),
        status=ProjectStatus.draft,
        created_at=now,
        updated_at=now,
        stats=ReconstructionStats(),
        write_amplification=WriteAmplification(),
        **payload.model_dump(),
    )
    manifest.save(project)
    logger.info("Project created: slug=%s name=%s", project.slug, project.name)
    return project


def update_project(slug: str, payload: ProjectUpdate) -> Project:
    project = get_project(slug)
    if project.status in (
        ProjectStatus.queued,
        ProjectStatus.extracting,
        ProjectStatus.matching,
        ProjectStatus.sparse,
        ProjectStatus.dense,
    ):
        raise ProjectConflictError("Cannot edit a project while it is running")
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return project
    updated = project.model_copy(update={**updates, "updated_at": _now()})
    manifest.save(updated)
    logger.info("Project updated: slug=%s fields=%s", slug, sorted(updates))
    return updated


def delete_project(slug: str) -> None:
    if not manifest.exists(slug):
        raise ProjectNotFoundError()
    # prefix-scoped — never bucket-wide (repo.artifacts.delete_under refuses a
    # non-slash-terminated prefix as a second guard).
    artifacts.delete_under(manifest.project_prefix(slug))
    logger.info("Project deleted: slug=%s", slug)


_RUNNING_STATUSES = {
    ProjectStatus.queued,
    ProjectStatus.extracting,
    ProjectStatus.matching,
    ProjectStatus.sparse,
    ProjectStatus.dense,
}


def get_capabilities() -> ServerCapabilities:
    """Auto-detected reconstruction capabilities (CUDA → CPU) for form gating."""
    device = detect_device()
    return ServerCapabilities(device=device, dense_available=device == "cuda")


def get_project_stats() -> ProjectStats:
    """Aggregate project + storage metrics for the dashboard."""
    all_objs = artifacts.list_under(manifest.PROJECTS_PREFIX)
    grouped = _objs_by_slug(all_objs)
    projects = [_overlay_live(p, grouped.get(p.slug, [])) for p in manifest.list_all()]

    running = sum(1 for p in projects if p.status in _RUNNING_STATUSES)
    archived = sum(1 for p in projects if p.status == ProjectStatus.archived)
    failed = sum(1 for p in projects if p.status == ProjectStatus.failed)
    draft = len(projects) - running - archived - failed

    source_bytes = sum(p.write_amplification.source_bytes for p in projects)
    artifact_bytes = sum(p.write_amplification.artifact_bytes for p in projects)
    ratio = round(artifact_bytes / source_bytes, 3) if source_bytes else 0.0

    return ProjectStats(
        total_projects=len(projects),
        draft=max(draft, 0),
        running=running,
        archived=archived,
        failed=failed,
        images_archived=sum(p.images_archived for p in projects),
        sparse_points=sum(p.stats.sparse_points for p in projects),
        source_bytes=source_bytes,
        source_bytes_human=humanize_bytes(source_bytes),
        artifact_bytes=artifact_bytes,
        artifact_bytes_human=humanize_bytes(artifact_bytes),
        ratio=ratio,
    )
