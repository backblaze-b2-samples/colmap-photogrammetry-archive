"""Hermetic tests for the Project lifecycle + write-amplification metric.

The B2 boundary is faked with an in-memory object store by monkeypatching the
``repo.artifacts`` functions that ``repo.manifest`` and ``service.projects`` call
through — no network, no boto3.
"""

from datetime import UTC, datetime

import pytest

from app.service import projects as svc
from app.service.project_artifacts import list_artifacts
from app.types.projects import ProjectCreate, ProjectStatus, ProjectUpdate


class FakeBucket:
    def __init__(self) -> None:
        self.store: dict[str, bytes] = {}

    def put_bytes(self, key: str, data: bytes, content_type: str) -> int:
        self.store[key] = data
        return len(data)

    def get_bytes(self, key: str) -> bytes | None:
        return self.store.get(key)

    def list_under(self, prefix: str) -> list[dict]:
        return [
            {"Key": k, "Size": len(v), "LastModified": datetime.now(UTC)}
            for k, v in self.store.items()
            if k.startswith(prefix)
        ]

    def delete_under(self, prefix: str) -> int:
        if not prefix or not prefix.endswith("/"):
            raise ValueError("delete_under requires a non-empty prefix ending in '/'")
        keys = [k for k in self.store if k.startswith(prefix)]
        for k in keys:
            del self.store[k]
        return len(keys)


@pytest.fixture
def bucket(monkeypatch):
    fake = FakeBucket()
    from app.repo import artifacts

    monkeypatch.setattr(artifacts, "put_bytes", fake.put_bytes)
    monkeypatch.setattr(artifacts, "get_bytes", fake.get_bytes)
    monkeypatch.setattr(artifacts, "list_under", fake.list_under)
    monkeypatch.setattr(artifacts, "delete_under", fake.delete_under)
    return fake


def test_create_derives_slug_and_persists_manifest(bucket):
    project = svc.create_project(ProjectCreate(name="Cathedral Facade"))
    assert project.slug == "cathedral-facade"
    assert project.status == ProjectStatus.draft
    assert "projects/cathedral-facade/manifest.json" in bucket.store


def test_duplicate_name_gets_a_unique_slug(bucket):
    a = svc.create_project(ProjectCreate(name="Statue"))
    b = svc.create_project(ProjectCreate(name="Statue"))
    assert a.slug == "statue"
    assert b.slug != a.slug and b.slug.startswith("statue-")


def test_update_changes_only_sent_fields(bucket):
    svc.create_project(ProjectCreate(name="Scene"))
    updated = svc.update_project("scene", ProjectUpdate(quality="high"))
    assert updated.quality.value == "high"
    assert updated.matcher.value == "sequential"  # unchanged default


def test_get_overlays_live_image_count_and_amplification(bucket):
    svc.create_project(ProjectCreate(name="Scene"))
    bucket.put_bytes("projects/scene/images/a.jpg", b"x" * 100, "image/jpeg")
    bucket.put_bytes("projects/scene/images/b.jpg", b"x" * 100, "image/jpeg")
    bucket.put_bytes("projects/scene/sparse/points.ply", b"y" * 400, "application/octet-stream")

    project = svc.get_project("scene")
    assert project.images_archived == 2
    assert project.write_amplification.source_bytes == 200
    assert project.write_amplification.artifact_bytes == 400
    assert project.write_amplification.ratio == 2.0  # 400 / 200


def test_delete_is_scoped_to_the_project_prefix(bucket):
    svc.create_project(ProjectCreate(name="Keep"))
    svc.create_project(ProjectCreate(name="Drop"))
    bucket.put_bytes("projects/drop/images/a.jpg", b"x", "image/jpeg")
    bucket.put_bytes("projects/keep/images/a.jpg", b"x", "image/jpeg")

    svc.delete_project("drop")

    assert not any(k.startswith("projects/drop/") for k in bucket.store)
    assert "projects/keep/manifest.json" in bucket.store


def test_delete_missing_project_raises(bucket):
    with pytest.raises(svc.ProjectNotFoundError):
        svc.delete_project("nope")


def test_scoped_artifact_explorer_lists_and_types(bucket):
    svc.create_project(ProjectCreate(name="Scene"))
    bucket.put_bytes("projects/scene/images/a.jpg", b"x", "image/jpeg")
    bucket.put_bytes("projects/scene/database.db", b"d", "application/octet-stream")
    bucket.put_bytes("projects/scene/sparse/points.ply", b"p", "application/octet-stream")

    kinds = {e.kind for e in list_artifacts("scene")}
    assert {"images", "database", "manifest"} <= kinds


def test_dashboard_stats_aggregate_amplification(bucket):
    svc.create_project(ProjectCreate(name="Scene"))
    bucket.put_bytes("projects/scene/images/a.jpg", b"x" * 50, "image/jpeg")
    bucket.put_bytes("projects/scene/sparse/points.ply", b"y" * 150, "application/octet-stream")

    stats = svc.get_project_stats()
    assert stats.total_projects == 1
    assert stats.source_bytes == 50
    assert stats.artifact_bytes == 150
    assert stats.ratio == 3.0


def test_archive_marks_the_archived_stage_done(bucket):
    """The engine returns with 'archived' still pending; the runner completes it."""
    from app.repo.colmap_engine import STAGE_SPECS, ColmapResult
    from app.service import reconstruction_runner as runner

    svc.create_project(ProjectCreate(name="Scene"))
    # Simulate the engine's terminal snapshot: every stage done, dense skipped
    # (CPU), and 'archived' still pending — the state the engine hands back.
    stages: list[dict] = []
    for name, label in STAGE_SPECS:
        if name == "archived":
            status = "pending"
        elif name == "dense":
            status = "skipped"
        else:
            status = "done"
        stages.append({"name": name, "label": label, "status": status, "detail": None})

    result = ColmapResult(
        database_db=b"d",
        points_ply=b"p",
        cameras_txt=b"c",
        images_txt=b"i",
        points3d_txt=b"3",
        registered_image_names=["a.jpg"],
        images_found=3,
        images_registered=3,
        sparse_points=10,
        mean_reproj_error=0.5,
        dense_points=None,
        device="cpu",
        stages=stages,
    )
    runner._archive_result("scene", result, 1.0)

    project = svc.get_project("scene")
    assert project.status == ProjectStatus.archived
    archived = next(s for s in project.stages if s.name == "archived")
    assert archived.status == "done"
    assert archived.detail  # carries its own evidence of completing
