from __future__ import annotations

# pylint: disable=invalid-name,global-statement

import os
import platform
import socket
import subprocess
from typing import Any, Callable, Dict, Optional, Union

ResourceAttributesInput = Union[Dict[str, Any], Callable[[], Dict[str, Any]]]

_cached_git_sha: Optional[str] = None
_git_sha_resolved = False

_GIT_SHA_ENV_VARS = (
    "OBYFLOW_GIT_SHA",
    "GIT_SHA",
    "GIT_COMMIT",
    "GITHUB_SHA",
    "VERCEL_GIT_COMMIT_SHA",
    "HEROKU_SLUG_COMMIT",
)


def _detect_git_sha() -> Optional[str]:
    global _cached_git_sha, _git_sha_resolved
    if _git_sha_resolved:
        return _cached_git_sha

    for var in _GIT_SHA_ENV_VARS:
        value = os.environ.get(var)
        if value:
            _cached_git_sha = value
            _git_sha_resolved = True
            return _cached_git_sha

    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=os.getcwd(),
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
        )
        sha = result.stdout.strip()
        _cached_git_sha = sha or None
    except Exception:
        _cached_git_sha = None

    _git_sha_resolved = True
    return _cached_git_sha


def base_resource_attributes() -> Dict[str, Any]:
    attrs: Dict[str, Any] = {
        "hostname": socket.gethostname(),
        "pid": os.getpid(),
        "python_version": platform.python_version(),
    }
    git_sha = _detect_git_sha()
    if git_sha:
        attrs["git_sha"] = git_sha
    return attrs


def resolve_resource_attributes(
    custom: Optional[ResourceAttributesInput] = None,
) -> Dict[str, Any]:
    base = base_resource_attributes()
    if not custom:
        return base
    extra = custom() if callable(custom) else custom
    merged = dict(base)
    merged.update(extra)
    return merged


def _reset_resource_attributes_cache_for_tests() -> None:
    global _cached_git_sha, _git_sha_resolved
    _cached_git_sha = None
    _git_sha_resolved = False
