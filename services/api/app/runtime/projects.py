"""REST routes for the Project entity (create/read/update/delete/run) plus the
project-scoped asset explorer. No business logic here — every handler delegates
to ``service/``.
"""

import logging

from fastapi import APIRouter, HTTPException

from app.service.project_artifacts import list_artifacts, presign_artifact
from app.service.projects import (
    ProjectConflictError,
    ProjectNotFoundError,
    ProjectValidationError,
    create_project,
    delete_project,
    get_capabilities,
    get_project,
    get_project_stats,
    list_projects,
    update_project,
)
from app.service.reconstruction_runner import run_project
from app.types.projects import (
    ArtifactEntry,
    Project,
    ProjectCreate,
    ProjectStats,
    ProjectUpdate,
    ServerCapabilities,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# --- collection + dashboard (static paths before /{slug}) -------------------


@router.get("/projects", response_model=list[Project])
def list_projects_endpoint():
    return list_projects()


@router.post("/projects", response_model=Project, status_code=201)
def create_project_endpoint(payload: ProjectCreate):
    return create_project(payload)


@router.get("/projects/stats", response_model=ProjectStats)
def project_stats_endpoint():
    return get_project_stats()


@router.get("/projects/capabilities", response_model=ServerCapabilities)
def project_capabilities_endpoint():
    return get_capabilities()


# --- scoped asset explorer (before /{slug} to avoid slug capture) -----------


@router.get("/projects/{slug}/artifacts/download")
def download_artifact_endpoint(slug: str, key: str):
    try:
        return {"url": presign_artifact(slug, key)}
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=404, detail=e.detail) from None


@router.get("/projects/{slug}/artifacts", response_model=list[ArtifactEntry])
def list_artifacts_endpoint(slug: str):
    try:
        return list_artifacts(slug)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=404, detail=e.detail) from None


@router.post("/projects/{slug}/run", response_model=Project)
def run_project_endpoint(slug: str):
    try:
        return run_project(slug)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=404, detail=e.detail) from None
    except ProjectValidationError as e:
        raise HTTPException(status_code=400, detail=e.detail) from None
    except ProjectConflictError as e:
        raise HTTPException(status_code=409, detail=e.detail) from None


# --- single project ---------------------------------------------------------


@router.get("/projects/{slug}", response_model=Project)
def get_project_endpoint(slug: str):
    try:
        return get_project(slug)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=404, detail=e.detail) from None


@router.patch("/projects/{slug}", response_model=Project)
def update_project_endpoint(slug: str, payload: ProjectUpdate):
    try:
        return update_project(slug, payload)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=404, detail=e.detail) from None
    except ProjectConflictError as e:
        raise HTTPException(status_code=409, detail=e.detail) from None


@router.delete("/projects/{slug}")
def delete_project_endpoint(slug: str):
    try:
        delete_project(slug)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=404, detail=e.detail) from None
    logger.info("Project deleted via API: slug=%s", slug)
    return {"deleted": True, "slug": slug}
