"""Project-scoped asset explorer: list and presign artifacts under one project.

Complements the full-bucket Files explorer (``service/files.py``): this one is
scoped to a single project's prefix and is driven off the same B2 listing the
manifest indexes. Presign requests are confined to the project's own prefix so a
scoped download can never sign an object belonging to another project.
"""

from app.repo import artifacts, manifest
from app.service.projects import ProjectNotFoundError
from app.types.formatting import humanize_bytes
from app.types.projects import ArtifactEntry


def _kind_for(relative: str) -> str:
    if relative == manifest.MANIFEST_NAME:
        return "manifest"
    if relative.startswith("images/"):
        return "images"
    if relative.startswith("sparse/"):
        return "sparse"
    if relative.startswith("dense/"):
        return "dense"
    if relative.endswith("points.ply"):
        return "points"
    if relative.endswith("database.db"):
        return "database"
    return "other"


def list_artifacts(slug: str) -> list[ArtifactEntry]:
    """Every object under ``projects/<slug>/`` as a typed artifact list."""
    if not manifest.exists(slug):
        raise ProjectNotFoundError()
    prefix = manifest.project_prefix(slug)
    entries: list[ArtifactEntry] = []
    for obj in artifacts.list_under(prefix):
        relative = obj["Key"][len(prefix) :]
        if not relative:
            continue
        entries.append(
            ArtifactEntry(
                key=obj["Key"],
                kind=_kind_for(relative),
                size_bytes=obj["Size"],
                size_human=humanize_bytes(obj["Size"]),
            )
        )
    entries.sort(key=lambda e: e.key)
    return entries


def presign_artifact(slug: str, key: str) -> str:
    """Presign a GET for one artifact, confined to this project's prefix."""
    prefix = manifest.project_prefix(slug)
    if not key.startswith(prefix):
        raise ProjectNotFoundError("Artifact does not belong to this project")
    if not manifest.exists(slug):
        raise ProjectNotFoundError()
    filename = key.rsplit("/", 1)[-1]
    return artifacts.presign_download(key, filename=filename)
