"""LangChain auto-instrumentation (FR11) — Python port of
packages/adapters/adapter-framework/src/langchain.ts.

Converts LangChain's callback-handler lifecycle (chain / tool / retriever /
LLM-call start-end-error) into Obyflow's canonical `chain` / `tool_call` /
`llm_call` events, joined to the active trace_id/request_id the same way
obyflow/instrumentation/vectordb.py joins vector DB and embedding calls.

`ObyflowLangChainCallbackHandler` is a plain class implementing LangChain's
`on_*` callback protocol and holds no import-time dependency on
`langchain_core` — the primary LangChain usage for this SDK is Python
(spec section 5), but not every obyflow-python install traces LangChain
apps, so the dependency stays optional. Use
`create_langchain_callback_handler()` to obtain an instance that is also a
real `langchain_core.callbacks.base.BaseCallbackHandler` subclass (required
for LangChain's callback manager to accept it); that helper lazily imports
`langchain_core` and raises a clear `ImportError` if it isn't installed.
"""
from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..client import SqliteStore
from ..context import get_active_request_id, get_active_trace_id
from ..events import validate_event

_PREVIEW_MAX_CHARS = 500


def _to_preview(value: Any) -> Optional[str]:
    """Renders an arbitrary value into a short, truncated preview string.
    Mirrors toPreview() in adapter-framework/src/shared.ts exactly, including
    the truncation length, so previews look the same regardless of which SDK
    produced them."""
    if value is None:
        return None
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, default=str)
        except (TypeError, ValueError):
            text = str(value)
    if len(text) <= _PREVIEW_MAX_CHARS:
        return text
    return text[:_PREVIEW_MAX_CHARS] + "…"


def _error_message(err: Any) -> str:
    if isinstance(err, BaseException):
        return str(err) or err.__class__.__name__
    return _to_preview(err) or "unknown error"


def _name_of(serialized: Optional[Dict[str, Any]], fallback: str, override: Optional[str] = None) -> str:
    if override:
        return override
    serialized = serialized or {}
    name = serialized.get("name")
    if name:
        return name
    ids = serialized.get("id")
    if isinstance(ids, list) and ids:
        return ids[-1]
    return fallback


def _extract_model_and_provider(serialized: Optional[Dict[str, Any]], kwargs: Dict[str, Any]) -> Dict[str, str]:
    invocation_params = kwargs.get("invocation_params") or {}
    model = (
        invocation_params.get("model")
        or invocation_params.get("model_name")
        or _name_of(serialized, "unknown")
    )
    ids = (serialized or {}).get("id")
    provider = ids[-2] if isinstance(ids, list) and len(ids) > 1 else _name_of(serialized, "unknown")
    return {"model": model, "provider": provider}


def _extract_llm_result(output: Any) -> Dict[str, Optional[Any]]:
    """Best-effort extraction of token usage + stop reason from a LangChain
    LLMResult-like object (duck-typed: works whether `output` is the real
    `langchain_core.outputs.LLMResult` or a plain dict, e.g. in tests)."""
    llm_output = getattr(output, "llm_output", None)
    if llm_output is None and isinstance(output, dict):
        llm_output = output.get("llm_output") or output.get("llmOutput")
    llm_output = llm_output or {}
    token_usage = llm_output.get("token_usage") or llm_output.get("tokenUsage") or {}
    usage = llm_output.get("usage") or {}

    prompt_tokens = token_usage.get("prompt_tokens") or usage.get("input_tokens")
    completion_tokens = token_usage.get("completion_tokens") or usage.get("output_tokens")

    generations = getattr(output, "generations", None)
    if generations is None and isinstance(output, dict):
        generations = output.get("generations")
    stop_reason = None
    if generations:
        try:
            first = generations[0][0]
        except (IndexError, TypeError):
            first = None
        if first is not None:
            info = getattr(first, "generation_info", None)
            if info is None and isinstance(first, dict):
                info = first.get("generation_info") or first.get("generationInfo")
            if info:
                stop_reason = info.get("finish_reason") or info.get("finishReason")

    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "stop_reason": stop_reason,
    }


class FrameworkInstrumentationContext:
    """Emits chain/tool_call/llm_call events joined to the active trace
    context. Mirrors VectorDbInstrumentationContext in
    obyflow/instrumentation/vectordb.py; kept as a separate small class
    (rather than imported from there) so this module has no coupling to the
    vector DB instrumentation."""

    def __init__(self, service: str, store: SqliteStore, deployment_id: Optional[str] = None):
        self.service = service
        self.store = store
        self.deployment_id = deployment_id

    def emit(
        self,
        event_type: str,
        attributes: Dict[str, Any],
        duration_ms: Optional[float],
        severity: Optional[str] = None,
    ) -> None:
        candidate = {
            "id": str(uuid.uuid4()),
            "type": event_type,
            "trace_id": get_active_trace_id(),
            "request_id": get_active_request_id(),
            "service": self.service,
            "host": None,
            "container": None,
            "deployment_id": self.deployment_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "duration_ms": duration_ms,
            "attributes": attributes,
            "severity": severity,
        }
        event = validate_event(candidate)
        self.store.insert(event)


class ObyflowLangChainCallbackHandler:
    """Implements LangChain's `on_*` callback-handler protocol and converts
    each completed run into a single `chain` / `tool_call` / `llm_call`
    event (one event per run, emitted on end/error — Obyflow's canonical
    Event Model records completed spans, not start/end pairs).

    Retriever runs are emitted as `chain` events (chain_name:
    "retriever:<name>") because the frozen canonical Event Model (spec
    section 6) has no distinct "retriever" event type — see the equivalent
    note in adapter-framework/src/langchain.ts.

    This class deliberately does not subclass `langchain_core`'s
    `BaseCallbackHandler` so it can be imported and unit tested without that
    optional dependency installed; use `create_langchain_callback_handler()`
    to get an instance LangChain's callback manager will actually accept.
    """

    def __init__(self, ctx: FrameworkInstrumentationContext, framework: str = "langchain"):
        self._ctx = ctx
        self._framework = framework
        self._runs: Dict[str, Dict[str, Any]] = {}

    # -- internal run tracking -------------------------------------------------

    def _start_run(self, run_id: str, kind: str, parent_run_id: Optional[str], name: Optional[str], **meta: Any) -> None:
        self._runs[str(run_id)] = {
            "kind": kind,
            "started_at": time.monotonic(),
            "parent_run_id": str(parent_run_id) if parent_run_id else None,
            "name": name,
            "meta": meta,
        }

    def _end_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        run = self._runs.pop(str(run_id), None)
        if run is None:
            return None
        run["latency_ms"] = (time.monotonic() - run["started_at"]) * 1000
        return run

    # -- chain ------------------------------------------------------------------

    def on_chain_start(
        self,
        serialized: Optional[Dict[str, Any]],
        inputs: Any,
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        self._start_run(
            run_id,
            "chain",
            parent_run_id,
            _name_of(serialized, "chain", kwargs.get("name")),
            input_preview=_to_preview(inputs),
        )

    def on_chain_end(self, outputs: Any, *, run_id: str, parent_run_id: Optional[str] = None, **kwargs: Any) -> None:
        self._emit_chain_event(run_id, parent_run_id, outputs=outputs, status="success")

    def on_chain_error(self, error: Any, *, run_id: str, parent_run_id: Optional[str] = None, **kwargs: Any) -> None:
        self._emit_chain_event(run_id, parent_run_id, outputs=_error_message(error), status="error")

    def _emit_chain_event(self, run_id: str, parent_run_id: Optional[str], outputs: Any, status: str) -> None:
        run = self._end_run(run_id)
        meta = (run or {}).get("meta", {})
        self._ctx.emit(
            "chain",
            {
                "framework": self._framework,
                "chain_name": (run or {}).get("name"),
                "graph_node": None,
                "run_id": str(run_id),
                "parent_run_id": str(parent_run_id) if parent_run_id else (run or {}).get("parent_run_id"),
                "input_preview": meta.get("input_preview"),
                "output_preview": _to_preview(outputs),
                "status": status,
            },
            (run or {}).get("latency_ms"),
            severity="error" if status == "error" else None,
        )

    # -- tool ---------------------------------------------------------------

    def on_tool_start(
        self,
        serialized: Optional[Dict[str, Any]],
        input_str: str,
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        self._start_run(
            run_id,
            "tool_call",
            parent_run_id,
            _name_of(serialized, "tool", kwargs.get("name")),
            args_preview=_to_preview(input_str),
        )

    def on_tool_end(self, output: Any, *, run_id: str, parent_run_id: Optional[str] = None, **kwargs: Any) -> None:
        self._emit_tool_event(run_id, parent_run_id, output=output, status="success")

    def on_tool_error(self, error: Any, *, run_id: str, parent_run_id: Optional[str] = None, **kwargs: Any) -> None:
        self._emit_tool_event(run_id, parent_run_id, output=_error_message(error), status="error")

    def _emit_tool_event(self, run_id: str, parent_run_id: Optional[str], output: Any, status: str) -> None:
        run = self._end_run(run_id)
        meta = (run or {}).get("meta", {})
        self._ctx.emit(
            "tool_call",
            {
                "tool_name": (run or {}).get("name") or "unknown",
                "args_preview": meta.get("args_preview"),
                "result_preview": _to_preview(output),
                "status": status,
                "run_id": str(run_id),
                "parent_run_id": str(parent_run_id) if parent_run_id else (run or {}).get("parent_run_id"),
            },
            (run or {}).get("latency_ms"),
            severity="error" if status == "error" else None,
        )

    # -- retriever (mapped onto `chain` events; see class docstring) --------

    def on_retriever_start(
        self,
        serialized: Optional[Dict[str, Any]],
        query: str,
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        self._start_run(
            run_id,
            "chain",
            parent_run_id,
            f"retriever:{_name_of(serialized, 'retriever', kwargs.get('name'))}",
        )

    def on_retriever_end(self, documents: Any, *, run_id: str, parent_run_id: Optional[str] = None, **kwargs: Any) -> None:
        count = len(documents) if isinstance(documents, (list, tuple)) else None
        self._emit_chain_event(run_id, parent_run_id, outputs={"result_count": count}, status="success")

    def on_retriever_error(self, error: Any, *, run_id: str, parent_run_id: Optional[str] = None, **kwargs: Any) -> None:
        self._emit_chain_event(run_id, parent_run_id, outputs=_error_message(error), status="error")

    # -- LLM / chat model -----------------------------------------------------

    def on_llm_start(
        self,
        serialized: Optional[Dict[str, Any]],
        prompts: List[str],
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        model_provider = _extract_model_and_provider(serialized, kwargs)
        self._start_run(
            run_id,
            "llm_call",
            parent_run_id,
            _name_of(serialized, "llm", kwargs.get("name")),
            model=model_provider["model"],
            provider=model_provider["provider"],
        )

    def on_chat_model_start(
        self,
        serialized: Optional[Dict[str, Any]],
        messages: List[List[Any]],
        *,
        run_id: str,
        parent_run_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        model_provider = _extract_model_and_provider(serialized, kwargs)
        self._start_run(
            run_id,
            "llm_call",
            parent_run_id,
            _name_of(serialized, "chat_model", kwargs.get("name")),
            model=model_provider["model"],
            provider=model_provider["provider"],
        )

    def on_llm_end(self, response: Any, *, run_id: str, parent_run_id: Optional[str] = None, **kwargs: Any) -> None:
        result = _extract_llm_result(response)
        self._emit_llm_event(run_id, parent_run_id, status="success", **result)

    def on_llm_error(self, error: Any, *, run_id: str, parent_run_id: Optional[str] = None, **kwargs: Any) -> None:
        self._emit_llm_event(
            run_id,
            parent_run_id,
            status="error",
            prompt_tokens=None,
            completion_tokens=None,
            stop_reason=_error_message(error),
        )

    def _emit_llm_event(
        self,
        run_id: str,
        parent_run_id: Optional[str],
        status: str,
        prompt_tokens: Optional[int],
        completion_tokens: Optional[int],
        stop_reason: Optional[str],
    ) -> None:
        run = self._end_run(run_id)
        meta = (run or {}).get("meta", {})
        self._ctx.emit(
            "llm_call",
            {
                "model": meta.get("model") or (run or {}).get("name") or "unknown",
                "provider": meta.get("provider") or "unknown",
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "latency_ms": (run or {}).get("latency_ms"),
                "stop_reason": stop_reason,
                "status": status,
                "run_id": str(run_id),
                "parent_run_id": str(parent_run_id) if parent_run_id else (run or {}).get("parent_run_id"),
            },
            (run or {}).get("latency_ms"),
            severity="error" if status == "error" else None,
        )


def create_langchain_callback_handler(
    service: str,
    store: SqliteStore,
    deployment_id: Optional[str] = None,
    framework: str = "langchain",
) -> ObyflowLangChainCallbackHandler:
    """Returns a LangChain-compatible callback handler (FR11): an instance
    that is both an `ObyflowLangChainCallbackHandler` and a real
    `langchain_core.callbacks.base.BaseCallbackHandler`, ready to pass as
    `callbacks=[handler]` to a chain/agent `.invoke()`/`.stream()` call, or
    to register globally. Requires the optional `langchain-core` dependency;
    raises `ImportError` with install instructions if it is missing.
    """
    try:
        from langchain_core.callbacks.base import BaseCallbackHandler
    except ImportError as exc:  # pragma: no cover - exercised via mocked import in tests
        raise ImportError(
            "obyflow.instrumentation.langchain.create_langchain_callback_handler() requires "
            "the optional 'langchain-core' dependency. Install it with: "
            "pip install obyflow-python[langchain]"
        ) from exc

    class _ObyflowLangChainCallbackHandler(ObyflowLangChainCallbackHandler, BaseCallbackHandler):
        pass

    ctx = FrameworkInstrumentationContext(service=service, store=store, deployment_id=deployment_id)
    return _ObyflowLangChainCallbackHandler(ctx, framework)
