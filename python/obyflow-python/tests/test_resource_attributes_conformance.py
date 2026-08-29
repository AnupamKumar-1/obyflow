import json
import subprocess
from pathlib import Path

import pytest

from obyflow import resource_attributes as ra

FIXTURE_PATH = Path(__file__).resolve().parents[3] / "fixtures" / "parity" / "resource_attributes.json"
GIT_SHA_ENV_VARS = [
    "OBYFLOW_GIT_SHA",
    "GIT_SHA",
    "GIT_COMMIT",
    "GITHUB_SHA",
    "VERCEL_GIT_COMMIT_SHA",
    "HEROKU_SLUG_COMMIT",
]

_FIXTURE = json.loads(FIXTURE_PATH.read_text())


@pytest.fixture(autouse=True)
def _clean_git_sha_env(monkeypatch):
    for key in GIT_SHA_ENV_VARS:
        monkeypatch.delenv(key, raising=False)
    ra._reset_resource_attributes_cache_for_tests()
    yield
    ra._reset_resource_attributes_cache_for_tests()


@pytest.mark.parametrize(
    "case", _FIXTURE["envPrecedenceCases"], ids=lambda c: c["name"]
)
def test_env_precedence_matches_shared_fixture(case, monkeypatch):
    for key, value in case["env"].items():
        monkeypatch.setenv(key, value)
    attrs = ra.base_resource_attributes()
    assert attrs["git_sha"] == case["expectedGitSha"]


def test_fallback_matches_shared_fixture():
    expected_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=Path.cwd(),
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    attrs = ra.base_resource_attributes()
    assert attrs["git_sha"] == expected_sha


@pytest.mark.parametrize("case", _FIXTURE["mergeCases"], ids=lambda c: c["name"])
def test_merge_matches_shared_fixture(case):
    merged = ra.resolve_resource_attributes(case["custom"])
    for key, value in case["expectMergedKeys"].items():
        assert merged[key] == value
