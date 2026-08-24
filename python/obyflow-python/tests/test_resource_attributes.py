import subprocess

import pytest

from obyflow import resource_attributes as ra
from obyflow.resource_attributes import (
    _GIT_SHA_ENV_VARS,
    _reset_resource_attributes_cache_for_tests,
)


@pytest.fixture(autouse=True)
def _reset_cache():
    _reset_resource_attributes_cache_for_tests()
    yield
    _reset_resource_attributes_cache_for_tests()


def test_base_resource_attributes_includes_hostname_pid_python_version():
    attrs = ra.base_resource_attributes()
    assert "hostname" in attrs
    assert "pid" in attrs
    assert "python_version" in attrs


def test_env_var_git_sha_is_preferred_over_subprocess(monkeypatch):
    monkeypatch.setenv("OBYFLOW_GIT_SHA", "envsha123")

    def _boom(*args, **kwargs):
        raise AssertionError("subprocess should not be called when an env var is present")

    monkeypatch.setattr(subprocess, "run", _boom)
    attrs = ra.base_resource_attributes()
    assert attrs["git_sha"] == "envsha123"


def test_env_var_precedence_order(monkeypatch):
    monkeypatch.delenv("OBYFLOW_GIT_SHA", raising=False)
    monkeypatch.setenv("GIT_SHA", "fromgitsha")
    monkeypatch.setenv("GIT_COMMIT", "fromgitcommit")
    attrs = ra.base_resource_attributes()
    assert attrs["git_sha"] == "fromgitsha"


def test_falls_back_to_git_rev_parse_when_no_env_var(monkeypatch):
    for var in _GIT_SHA_ENV_VARS:
        monkeypatch.delenv(var, raising=False)

    class FakeResult:
        stdout = "abc123fromgit\n"

    monkeypatch.setattr(
        subprocess, "run", lambda *args, **kwargs: FakeResult()
    )
    attrs = ra.base_resource_attributes()
    assert attrs["git_sha"] == "abc123fromgit"


def test_git_sha_omitted_when_not_detectable(monkeypatch):
    for var in _GIT_SHA_ENV_VARS:
        monkeypatch.delenv(var, raising=False)

    def _raise(*args, **kwargs):
        raise FileNotFoundError("git not installed")

    monkeypatch.setattr(subprocess, "run", _raise)
    attrs = ra.base_resource_attributes()
    assert "git_sha" not in attrs


def test_git_sha_is_cached_after_first_resolution(monkeypatch):
    monkeypatch.setenv("OBYFLOW_GIT_SHA", "cachedsha")
    first = ra.base_resource_attributes()
    monkeypatch.delenv("OBYFLOW_GIT_SHA", raising=False)
    second = ra.base_resource_attributes()
    assert first["git_sha"] == second["git_sha"] == "cachedsha"


def test_resolve_resource_attributes_with_no_custom_returns_base(monkeypatch):
    monkeypatch.setenv("OBYFLOW_GIT_SHA", "sha1")
    assert ra.resolve_resource_attributes(None) == ra.base_resource_attributes()


def test_resolve_resource_attributes_merges_static_dict(monkeypatch):
    monkeypatch.setenv("OBYFLOW_GIT_SHA", "sha1")
    merged = ra.resolve_resource_attributes({"config_hash": "abc", "hostname": "override"})
    assert merged["config_hash"] == "abc"
    assert merged["hostname"] == "override"
    assert merged["git_sha"] == "sha1"


def test_resolve_resource_attributes_merges_callable(monkeypatch):
    monkeypatch.setenv("OBYFLOW_GIT_SHA", "sha1")
    merged = ra.resolve_resource_attributes(lambda: {"model_version": "gpt-x-2"})
    assert merged["model_version"] == "gpt-x-2"
    assert merged["git_sha"] == "sha1"
