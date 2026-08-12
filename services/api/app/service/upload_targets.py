"""Where a direct-to-B2 upload is allowed to land.

Every object the app writes lives under one of these prefixes; the API mints the
key so the client never chooses an arbitrary destination. The default is
``uploads/``; an Ingest upload targets a project's own ``images/`` prefix
instead. Kept separate from ``service/upload.py`` so that module stays under the
300-line structural ceiling. No ``UploadError`` dependency here (avoids an import
cycle) — callers turn an invalid slug into the right HTTP error.
"""

import re

UPLOAD_PREFIX = "uploads/"
PROJECTS_PREFIX = "projects/"
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def is_valid_slug(slug: str) -> bool:
    return bool(_SLUG_RE.match(slug))


def target_prefix(project_slug: str | None) -> str | None:
    """Prefix a presigned upload may write to.

    Returns ``uploads/`` when no project is given, the project's ``images/``
    ingest prefix for a valid slug, or None when the slug is malformed (the
    caller rejects it).
    """
    if not project_slug:
        return UPLOAD_PREFIX
    if not is_valid_slug(project_slug):
        return None
    return f"{PROJECTS_PREFIX}{project_slug}/images/"


def is_project_image_key(key: str) -> bool:
    """True for a projects/<slug>/images/<file> key (verify-time allow-list)."""
    if not key.startswith(PROJECTS_PREFIX):
        return False
    parts = key[len(PROJECTS_PREFIX) :].split("/")
    return len(parts) >= 3 and is_valid_slug(parts[0]) and parts[1] == "images"
