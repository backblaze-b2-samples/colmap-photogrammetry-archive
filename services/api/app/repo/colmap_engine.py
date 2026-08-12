"""COLMAP structure-from-motion engine — the marquee reconstruction workload.

Runs REAL COLMAP SfM via ``pycolmap`` (COLMAP's own bindings): SIFT extraction,
exhaustive/sequential/spatial matching, then incremental mapping into a sparse
point cloud. Returns the match ``database.db``, the sparse model text files, and
``points.ply`` as raw bytes so the caller can archive every artifact on B2.

Device stance (``deployment: local``): sparse SfM always runs on CPU. Dense MVS
is CUDA-only and auto-gated (attempted only on a CUDA host, else a clean skip).
Apple MPS is N/A to COLMAP's C++/CUDA kernels, so the auto-detect order is
CUDA → CPU with CPU the safe default (never a hard GPU requirement).

``pycolmap`` is imported LAZILY inside the functions so importing this module
(and thus the FastAPI app, tests, and OpenAPI export) never needs the heavy
wheel. It runs in an isolated worker process (``service/colmap_worker.py``) so a
native COLMAP crash can't wedge the API.
"""

import contextlib
import shutil
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

_QUALITY_FEATURES = {"low": 2048, "medium": 4096, "high": 8192}

# The reconstruction timeline surfaced in the UI. (name, label) pairs; status is
# filled in as the run advances.
STAGE_SPECS = [
    ("ingest", "Stage photos"),
    ("extracting", "SIFT feature extraction (CPU)"),
    ("matching", "Feature matching"),
    ("sparse", "Incremental mapping (sparse SfM)"),
    ("dense", "Dense MVS (CUDA only)"),
    ("archived", "Archive artifacts to B2"),
]


@dataclass
class ColmapResult:
    database_db: bytes
    points_ply: bytes
    cameras_txt: bytes
    images_txt: bytes
    points3d_txt: bytes
    registered_image_names: list[str]
    images_found: int
    images_registered: int
    sparse_points: int
    mean_reproj_error: float
    dense_points: int | None
    device: str
    # Non-empty only when dense MVS ran (CUDA); archived as dense/fused.ply.
    dense_ply: bytes = b""
    stages: list[dict] = field(default_factory=list)


def detect_device() -> str:
    """Auto-detect the compute device: CUDA if present, else CPU.

    COLMAP's GPU path is CUDA-only (Apple MPS is not applicable to its C++/CUDA
    kernels), so the order is CUDA → CPU with CPU as the safe default. Never
    hard-requires a GPU.
    """
    try:
        import pycolmap

        if bool(getattr(pycolmap, "has_cuda", False)):
            return "cuda"
    except Exception:
        pass
    return "cuda" if shutil.which("nvidia-smi") else "cpu"


def _safe_call(fn, *args, **kwargs):
    """Call ``fn`` dropping kwargs it doesn't accept (pycolmap version drift)."""
    while True:
        try:
            return fn(*args, **kwargs)
        except TypeError as exc:
            dropped = False
            for key in list(kwargs):
                if key in str(exc):
                    kwargs.pop(key)
                    dropped = True
                    break
            if not dropped:
                raise


def _set(obj, attr, value) -> None:
    if hasattr(obj, attr):
        with contextlib.suppress(Exception):
            setattr(obj, attr, value)


def _read(path: Path) -> bytes:
    return path.read_bytes() if path.exists() else b""


def _num_reg_images(rec) -> int:
    for attr in ("num_reg_images", "reg_image_ids"):
        fn = getattr(rec, attr, None)
        if callable(fn):
            with contextlib.suppress(Exception):
                value = fn()
                return value if isinstance(value, int) else len(value)
    return len(getattr(rec, "images", {}))


def _mean_reproj_error(rec) -> float:
    for name in ("compute_mean_reprojection_error", "compute_mean_reproj_error"):
        fn = getattr(rec, name, None)
        if callable(fn):
            with contextlib.suppress(Exception):
                return round(float(fn()), 4)
    return 0.0


def _match(pycolmap, matcher: str, database_path, device) -> None:
    """Dispatch to the matcher COLMAP exposes, falling back to exhaustive."""
    fn = {
        "sequential": getattr(pycolmap, "match_sequential", None),
        "spatial": getattr(pycolmap, "match_spatial", None),
        "exhaustive": getattr(pycolmap, "match_exhaustive", None),
    }.get(matcher) or pycolmap.match_exhaustive
    _safe_call(fn, database_path, device=device)


def run_reconstruction(
    images: list[tuple[str, bytes]],
    *,
    quality: str,
    matcher: str,
    enable_dense: bool,
    device: str | None = None,
    progress: Callable[[list[dict]], None] | None = None,
) -> ColmapResult:
    """Run COLMAP SfM over ``images`` and return the derived artifacts as bytes.

    ``images`` is ``[(name, jpeg_or_png_bytes), ...]``. Raises ValueError when
    COLMAP cannot register a model (too few overlapping views). ``progress``
    (when given) receives a fresh stage-list snapshot after each transition.
    """
    import pycolmap

    dev = device or detect_device()
    stages = [
        {"name": n, "label": lbl, "status": "pending", "detail": None} for n, lbl in STAGE_SPECS
    ]

    def _stage(name: str, status: str, detail: str | None = None) -> None:
        for stage in stages:
            if stage["name"] == name:
                stage["status"] = status
                if detail is not None:
                    stage["detail"] = detail
        if progress is not None:
            progress([dict(s) for s in stages])

    if len(images) < 3:
        raise ValueError("Need at least 3 overlapping photos to reconstruct — add more.")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        image_dir = root / "images"
        image_dir.mkdir()
        for name, data in images:
            (image_dir / name).write_bytes(data)
        _stage("ingest", "done", f"{len(images)} photos staged for SfM")

        database_path = root / "database.db"
        cpu = pycolmap.Device.cpu
        max_features = _QUALITY_FEATURES.get(quality, 4096)
        sift = pycolmap.SiftExtractionOptions()
        _set(sift, "max_num_features", max_features)
        _set(sift, "use_gpu", False)  # force CPU SIFT (pip wheel is CPU-only)

        _stage("extracting", "running", f"SIFT (max {max_features} feats/img, CPU)")
        _safe_call(
            pycolmap.extract_features,
            database_path,
            image_dir,
            camera_model="OPENCV",
            sift_options=sift,
            device=cpu,
        )
        _stage("extracting", "done", f"SIFT (max {max_features} feats/img, CPU)")

        _stage("matching", "running", f"{matcher} matching")
        _match(pycolmap, matcher, database_path, cpu)
        _stage("matching", "done", f"{matcher} matching")

        _stage("sparse", "running", "incremental mapping")
        output_path = root / "sparse"
        output_path.mkdir()
        maps = _safe_call(pycolmap.incremental_mapping, database_path, image_dir, output_path)
        recs = list(maps.values()) if isinstance(maps, dict) else list(maps)
        if not recs:
            _stage("sparse", "failed", "no model registered")
            raise ValueError(
                "COLMAP could not reconstruct a model from these photos — "
                "capture more overlapping views with steady parallax."
            )
        rec = max(recs, key=_num_reg_images)
        reg = _num_reg_images(rec)

        model_dir = root / "model"
        model_dir.mkdir()
        _safe_call(rec.write_text, str(model_dir))
        ply_path = root / "points.ply"
        with contextlib.suppress(Exception):
            rec.export_PLY(str(ply_path))

        try:
            sparse_points = int(rec.num_points3D())
        except Exception:
            sparse_points = len(getattr(rec, "points3D", {}))
        _stage("sparse", "done", f"{reg}/{len(images)} images, {sparse_points:,} points")

        dense_points, dense_ply = _maybe_dense(
            pycolmap, dev, enable_dense, root, image_dir, rec, _stage
        )

        names = [rec.images[i].name for i in sorted(rec.images)]
        return ColmapResult(
            database_db=_read(database_path),
            points_ply=_read(ply_path),
            cameras_txt=_read(model_dir / "cameras.txt"),
            images_txt=_read(model_dir / "images.txt"),
            points3d_txt=_read(model_dir / "points3D.txt"),
            registered_image_names=names,
            images_found=len(images),
            images_registered=reg,
            sparse_points=sparse_points,
            mean_reproj_error=_mean_reproj_error(rec),
            dense_points=dense_points,
            device=dev,
            dense_ply=dense_ply,
            stages=stages,
        )


def _maybe_dense(
    pycolmap, device, enable_dense, root, image_dir, rec, stage
) -> tuple[int | None, bytes]:
    """Dense MVS is CUDA-only — attempt only on a CUDA host, else record skip.

    On a CUDA host this runs the REAL dense pipeline (undistort -> patch-match
    stereo -> fusion) and returns (fused point count, fused.ply bytes). It is
    fully guarded: any failure (or a COLMAP build without CUDA dense support)
    records a clean skip rather than crashing or claiming a fake success. On CPU
    it always skips and returns no bytes.
    """
    if not enable_dense:
        stage("dense", "skipped", "dense stage disabled for this project")
        return None, b""
    if device != "cuda":
        stage(
            "dense",
            "skipped",
            "requires a CUDA build of COLMAP — sparse model archived for GPU jobs",
        )
        return None, b""
    try:
        dense_dir = root / "dense"
        dense_dir.mkdir(exist_ok=True)
        sparse_bin = root / "sparse_bin"
        sparse_bin.mkdir(exist_ok=True)
        _safe_call(rec.write, str(sparse_bin))
        _safe_call(pycolmap.undistort_images, dense_dir, image_dir, sparse_bin)
        _safe_call(pycolmap.patch_match_stereo, dense_dir)
        fused = dense_dir / "fused.ply"
        _safe_call(pycolmap.stereo_fusion, fused, dense_dir)
        points = _ply_vertex_count(fused)
        stage("dense", "done", f"patch-match stereo + fusion ({points:,} points)")
        return points, _read(fused)
    except Exception as exc:  # CUDA-less build / API drift -> clean skip
        stage("dense", "skipped", f"dense MVS unavailable in this build: {exc}")
        return None, b""


def _ply_vertex_count(path: Path) -> int:
    """Read `element vertex N` from a PLY header (0 if absent)."""
    if not path.exists():
        return 0
    with path.open("rb") as fh:
        for _ in range(40):
            line = fh.readline()
            if not line or line.strip() == b"end_header":
                break
            if line.startswith(b"element vertex"):
                with contextlib.suppress(ValueError):
                    return int(line.split()[-1])
    return 0
