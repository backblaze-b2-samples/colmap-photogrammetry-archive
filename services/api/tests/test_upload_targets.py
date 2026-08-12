"""Unit tests for the direct-upload destination rules."""

from app.service.upload_targets import (
    UPLOAD_PREFIX,
    is_project_image_key,
    is_valid_slug,
    target_prefix,
)


def test_default_target_is_uploads_prefix():
    assert target_prefix(None) == UPLOAD_PREFIX
    assert target_prefix("") == UPLOAD_PREFIX


def test_project_target_is_scoped_images_prefix():
    assert target_prefix("demo-scene") == "projects/demo-scene/images/"


def test_malformed_slug_is_rejected():
    assert target_prefix("../evil") is None
    assert target_prefix("Bad Slug") is None
    assert is_valid_slug("ok-slug-1") is True
    assert is_valid_slug("../x") is False


def test_verify_allow_list_matches_project_images_only():
    assert is_project_image_key("projects/demo/images/a.jpg") is True
    assert is_project_image_key("projects/demo/sparse/points.ply") is False
    assert is_project_image_key("uploads/a.jpg") is False
    assert is_project_image_key("projects/../images/a.jpg") is False
