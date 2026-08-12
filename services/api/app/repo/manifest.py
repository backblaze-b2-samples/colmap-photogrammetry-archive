"""The per-project manifest is the canonical artifact index — B2 is the store.

Each Project persists as JSON at ``projects/<slug>/manifest.json``. There is no
database: listing projects scans ``projects/`` for ``*/manifest.json`` and reads
each one. This module wraps the raw B2 object I/O (via ``repo.artifacts``) with
``Project``-typed read/write helpers and prefix helpers, keeping boto3 confined
to the ``repo/`` layer.
"""

import logging

from app.repo import artifacts
from app.types.projects import Project

logger = logging.getLogger(__name__)

PROJECTS_PREFIX = "projects/"
MANIFEST_NAME = "manifest.json"


def project_prefix(slug: str) -> str:
    """B2 prefix that holds everything for one project (slash-terminated)."""
    return f"{PROJECTS_PREFIX}{slug}/"


def images_prefix(slug: str) -> str:
    """Where a project's ingested source photos live."""
    return f"{PROJECTS_PREFIX}{slug}/images/"


def manifest_key(slug: str) -> str:
    return f"{PROJECTS_PREFIX}{slug}/{MANIFEST_NAME}"


def save(project: Project) -> None:
    """Write the manifest for ``project`` to B2."""
    artifacts.put_bytes(
        manifest_key(project.slug),
        project.model_dump_json(indent=2).encode("utf-8"),
        "application/json",
    )


def load(slug: str) -> Project | None:
    """Read one project's manifest, or None when it does not exist."""
    data = artifacts.get_bytes(manifest_key(slug))
    if data is None:
        return None
    try:
        return Project.model_validate_json(data)
    except ValueError:
        logger.warning("Unreadable project manifest: %s", manifest_key(slug))
        return None


def exists(slug: str) -> bool:
    return artifacts.get_bytes(manifest_key(slug)) is not None


def list_all() -> list[Project]:
    """Every project, newest first. Scans projects/ for */manifest.json."""
    out: list[Project] = []
    for obj in artifacts.list_under(PROJECTS_PREFIX):
        if not obj["Key"].endswith(f"/{MANIFEST_NAME}"):
            continue
        data = artifacts.get_bytes(obj["Key"])
        if data is None:
            continue
        try:
            out.append(Project.model_validate_json(data))
        except ValueError:
            logger.warning("Skipping unreadable project manifest: %s", obj["Key"])
    out.sort(key=lambda p: p.created_at, reverse=True)
    return out
