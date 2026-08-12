"""Seed a demo Project so a fresh clone has something to reconstruct.

This is an OPTIONAL convenience. The primary demo path is: create a project in
the UI, upload your own overlapping photos, then Run. This script just creates a
``demo-scene`` project and ingests a small multi-view photo set into its B2
prefix (``projects/demo-scene/images/``) so you can click Run immediately.

No imagery is committed to this repository. You point the script at a photo
source at runtime:

    # From a local folder of your own overlapping photos (recommended):
    python scripts/seed_demo_project.py --images-dir ~/photos/statue

    # Or fetch a zip of images from a URL you trust to be CC0 / public-domain
    # (document the provenance yourself — this repo hardcodes no dataset URL to
    # avoid making a licensing claim on third-party imagery):
    python scripts/seed_demo_project.py --source-url https://example.com/scene.zip

Needs the backend virtualenv and a configured repo-root ``.env`` (B2
credentials), exactly like the app. Run it from the repo root.
"""

from __future__ import annotations

import argparse
import io
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
API_ROOT = REPO_ROOT / "services" / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(REPO_ROOT / ".env")

from app.repo import artifacts, manifest  # noqa: E402
from app.service.projects import create_project, get_project  # noqa: E402
from app.types.projects import ProjectCreate  # noqa: E402

_IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
_DEMO_SLUG = "demo-scene"


def out(message: str) -> None:
    sys.stdout.write(f"{message}\n")


def _images_from_dir(path: Path) -> list[tuple[str, bytes]]:
    files = sorted(p for p in path.iterdir() if p.suffix.lower() in _IMAGE_EXTS)
    return [(p.name, p.read_bytes()) for p in files]


def _images_from_zip_url(url: str) -> list[tuple[str, bytes]]:
    out(f"Fetching {url} …")
    with urllib.request.urlopen(url) as resp:  # noqa: S310 - operator-provided URL
        data = resp.read()
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            zf.extractall(tmp)
        images: list[tuple[str, bytes]] = []
        for p in sorted(Path(tmp).rglob("*")):
            if p.suffix.lower() in _IMAGE_EXTS:
                images.append((p.name, p.read_bytes()))
        return images


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--images-dir", type=Path, help="Local folder of photos")
    group.add_argument("--source-url", help="URL of a zip of CC0/PD photos")
    args = parser.parse_args()

    if args.images_dir:
        images = _images_from_dir(args.images_dir)
    else:
        images = _images_from_zip_url(args.source_url)

    if len(images) < 3:
        out("Need at least 3 overlapping photos to reconstruct. Aborting.")
        return 2

    try:
        project = get_project(_DEMO_SLUG)
        out(f"Reusing existing project '{project.slug}'.")
    except Exception:
        project = create_project(ProjectCreate(name="Demo Scene"))
        out(f"Created project '{project.slug}'.")

    prefix = manifest.images_prefix(project.slug)
    for name, data in images:
        artifacts.put_bytes(f"{prefix}{name}", data, "image/jpeg")
    out(f"Ingested {len(images)} photos into {prefix}")
    out(f"Open /projects/{project.slug} in the app and click Run reconstruction.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
