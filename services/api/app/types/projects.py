"""Pydantic models for the photogrammetry-archive Project entity.

A Project is a structure-from-motion scene. Its system of record is a JSON
manifest in B2 (``projects/<slug>/manifest.json``) — there is no database. These
models are the boundary contract for the ``/projects`` API and are mirrored in
``packages/shared/src/types.ts`` on the frontend.
"""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class ProjectStatus(StrEnum):
    """Lifecycle of a reconstruction, in order.

    ``draft`` (created, no run yet) → ``queued`` → the COLMAP stages
    (``extracting`` → ``matching`` → ``sparse`` → ``dense``) → ``archived``
    (manifest + artifacts written to B2) or ``failed``.
    """

    draft = "draft"
    queued = "queued"
    extracting = "extracting"
    matching = "matching"
    sparse = "sparse"
    dense = "dense"
    archived = "archived"
    failed = "failed"


class MatcherMode(StrEnum):
    """COLMAP feature-matching strategy."""

    exhaustive = "exhaustive"
    sequential = "sequential"
    spatial = "spatial"


class FeatureQuality(StrEnum):
    """SIFT feature budget per image (low/medium/high)."""

    low = "low"
    medium = "medium"
    high = "high"


class ReconstructionStats(BaseModel):
    """Metrics recovered from a COLMAP run."""

    images_found: int = 0
    images_registered: int = 0
    sparse_points: int = 0
    mean_reproj_error: float = 0.0
    # None until a CUDA host runs dense MVS (skipped on CPU).
    dense_points: int | None = None


class ArtifactEntry(BaseModel):
    """One derived artifact archived under the project prefix."""

    key: str
    kind: str  # images | database | sparse | dense | points | manifest
    size_bytes: int
    size_human: str


class WriteAmplification(BaseModel):
    """The headline metric: derived bytes vs source bytes.

    ``ratio`` = artifact_bytes / source_bytes (0.0 when there are no source
    bytes yet). A ratio ≥ 1 means the reconstruction fanned the photo set out
    into at least as many bytes of derived artifacts.
    """

    source_bytes: int = 0
    source_bytes_human: str = "0.0 B"
    artifact_bytes: int = 0
    artifact_bytes_human: str = "0.0 B"
    ratio: float = 0.0


class PipelineStage(BaseModel):
    """One stage in the reconstruction timeline."""

    name: str
    label: str
    status: str = "pending"  # pending | running | done | skipped | failed
    detail: str | None = None


class ProjectCreate(BaseModel):
    """Request body to create a Project."""

    name: str = Field(min_length=1, max_length=120)
    matcher: MatcherMode = MatcherMode.sequential
    quality: FeatureQuality = FeatureQuality.medium
    # None = keep original resolution; otherwise the longest edge in pixels.
    max_image_dim: int | None = 1600
    enable_dense: bool = False
    # Optional: reconstruct from an existing bucket prefix instead of the
    # project's own projects/<slug>/images/ ingest prefix. Free text.
    source_prefix: str = ""


class ProjectUpdate(BaseModel):
    """Editable Project settings (all optional — only sent fields change)."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    matcher: MatcherMode | None = None
    quality: FeatureQuality | None = None
    max_image_dim: int | None = None
    enable_dense: bool | None = None
    source_prefix: str | None = None


class Project(BaseModel):
    """A photogrammetry-archive scene (the manifest persisted to B2)."""

    slug: str
    name: str
    status: ProjectStatus = ProjectStatus.draft
    matcher: MatcherMode = MatcherMode.sequential
    quality: FeatureQuality = FeatureQuality.medium
    max_image_dim: int | None = 1600
    enable_dense: bool = False
    source_prefix: str = ""

    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    # Compute device the last run used (cpu | cuda). Informational.
    device: str | None = None
    # Wall-clock seconds of the last completed run.
    duration_seconds: float | None = None
    error: str | None = None

    images_archived: int = 0
    stats: ReconstructionStats = ReconstructionStats()
    write_amplification: WriteAmplification = WriteAmplification()
    stages: list[PipelineStage] = Field(default_factory=list)
    artifacts: list[ArtifactEntry] = Field(default_factory=list)


class ServerCapabilities(BaseModel):
    """What the local reconstruction host can do (drives dense-stage gating)."""

    # Auto-detected compute device for reconstruction: "cpu" or "cuda".
    device: str = "cpu"
    # Dense MVS is CUDA-only; the form disables the dense toggle when false.
    dense_available: bool = False


class ProjectStats(BaseModel):
    """Dashboard aggregate across every Project in the bucket."""

    total_projects: int = 0
    draft: int = 0
    running: int = 0
    archived: int = 0
    failed: int = 0
    images_archived: int = 0
    sparse_points: int = 0
    source_bytes: int = 0
    source_bytes_human: str = "0.0 B"
    artifact_bytes: int = 0
    artifact_bytes_human: str = "0.0 B"
    # Overall write-amplification ratio (artifact_bytes / source_bytes).
    ratio: float = 0.0
