from datetime import datetime

from pydantic import BaseModel

from app.types.files import FileMetadataDetail


class FileUploadResponse(BaseModel):
    key: str
    filename: str
    size_bytes: int
    size_human: str
    content_type: str
    uploaded_at: datetime
    url: str | None = None
    metadata: FileMetadataDetail | None = None


class PresignUploadRequest(BaseModel):
    """What the browser declares before uploading directly to B2."""

    filename: str
    content_type: str
    size_bytes: int
    # Optional: target a project's ingest prefix (projects/<slug>/images/)
    # instead of the default uploads/ prefix. None keeps the generic path.
    project_slug: str | None = None


class PresignUploadResponse(BaseModel):
    """A short-lived presigned PUT the browser uploads to, plus the exact
    headers it must send. `Content-Length` and `content-type` are signed into
    the URL, so B2 rejects a body of any other size or type.
    """

    key: str
    url: str
    method: str
    content_type: str
    headers: dict[str, str]
    expires_in: int


class VerifyUploadRequest(BaseModel):
    """Sent after the direct PUT so the API can inspect the stored object."""

    key: str
