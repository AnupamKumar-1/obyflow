from __future__ import annotations

import sys

import pytest

from obyflow.client import SqliteStore
from obyflow.context import TraceContext, reset_trace_context, set_trace_context
from obyflow.instrumentation.langchain import (
    FrameworkInstrumentationContext,
    ObyflowLangChainCallbackHandler,
    create_langchain_callback_handler,
)


def _traced(store: SqliteStore, trace_id: str, request_id: str):

    return set_trace_context(TraceContext(trace_id=trace_id, request_id=request_id))


def test_chain_lifecycle_emits_event_with_duration_and_linkage(tmp_path):
    store = SqliteStore(tmp_path / "obyflow.db")
    ctx = FrameworkInstrumentationContext(service="rag-svc", store=store)
    handler = ObyflowLangChainCallbackHandler(ctx)

    token = _traced(store, "trace-1", "req-1")
    try:
        handler.on_chain_start(
            {"name": "RetrievalQAChain"}, {"question": "hi"}, run_id="run-1"
        )
        handler.on_chain_end({"answer": "hello"}, run_id="run-1")
    finally:
        reset_trace_context(token)

    rows = store.get_by_trace_id("trace-1")
    assert len(rows) == 1
    assert rows[0].type == "chain"
    assert rows[0].attributes["chain_name"] == "RetrievalQAChain"
    assert rows[0].attributes["status"] == "success"
    assert rows[0].attributes["run_id"] == "run-1"
    assert rows[0].duration_ms is not None
    assert rows[0].severity is None


def test_chain_error_sets_error_status_and_severity(tmp_path):
    store = SqliteStore(tmp_path / "obyflow.db")
    ctx = FrameworkInstrumentationContext(service="rag-svc", store=store)
    handler = ObyflowLangChainCallbackHandler(ctx)

    token = _traced(store, "trace-2", "req-2")
    try:
        handler.on_chain_start(
            {"name": "AgentExecutor"}, {}, run_id="run-2", parent_run_id="parent-1"
        )
        handler.on_chain_error(
            RuntimeError("tool timed out"), run_id="run-2", parent_run_id="parent-1"
        )
    finally:
        reset_trace_context(token)

    rows = store.get_by_trace_id("trace-2")
    assert len(rows) == 1
    assert rows[0].attributes["status"] == "error"
    assert "tool timed out" in rows[0].attributes["output_preview"]
    assert rows[0].attributes["parent_run_id"] == "parent-1"
    assert rows[0].severity == "error"


def test_chain_end_for_untracked_run_id_still_emits_event(tmp_path):
    store = SqliteStore(tmp_path / "obyflow.db")
    ctx = FrameworkInstrumentationContext(service="rag-svc", store=store)
    handler = ObyflowLangChainCallbackHandler(ctx)

    token = _traced(store, "trace-3", "req-3")
    try:
        handler.on_chain_end({"ok": True}, run_id="orphan-run")
    finally:
        reset_trace_context(token)

    rows = store.get_by_trace_id("trace-3")
    assert len(rows) == 1
    assert rows[0].attributes["run_id"] == "orphan-run"
    assert rows[0].attributes["chain_name"] is None
    assert rows[0].duration_ms is None


def test_tool_call_success_and_failure(tmp_path):
    store = SqliteStore(tmp_path / "obyflow.db")
    ctx = FrameworkInstrumentationContext(service="rag-svc", store=store)
    handler = ObyflowLangChainCallbackHandler(ctx)

    token = _traced(store, "trace-4", "req-4")
    try:
        handler.on_tool_start(
            {"name": "search_orders"}, '{"orderId":"1"}', run_id="tool-1"
        )
        handler.on_tool_end("order not found", run_id="tool-1")

        handler.on_tool_start({"name": "search_orders"}, "{}", run_id="tool-2")
        handler.on_tool_error(RuntimeError("timed out after 30s"), run_id="tool-2")
    finally:
        reset_trace_context(token)

    rows = {r.attributes["run_id"]: r for r in store.get_by_trace_id("trace-4")}
    assert rows["tool-1"].type == "tool_call"
    assert rows["tool-1"].attributes["status"] == "success"
    assert rows["tool-1"].attributes["result_preview"] == "order not found"

    assert rows["tool-2"].attributes["status"] == "error"
    assert "timed out after 30s" in rows["tool-2"].attributes["result_preview"]
    assert rows["tool-2"].severity == "error"


def test_retriever_maps_onto_chain_event_with_result_count(tmp_path):
    store = SqliteStore(tmp_path / "obyflow.db")
    ctx = FrameworkInstrumentationContext(service="rag-svc", store=store)
    handler = ObyflowLangChainCallbackHandler(ctx)

    token = _traced(store, "trace-5", "req-5")
    try:
        handler.on_retriever_start(
            {"name": "VectorStoreRetriever"}, "why did checkout fail?", run_id="ret-1"
        )
        handler.on_retriever_end(
            [{"page_content": "a"}, {"page_content": "b"}], run_id="ret-1"
        )
    finally:
        reset_trace_context(token)

    rows = store.get_by_trace_id("trace-5")
    assert len(rows) == 1
    assert rows[0].type == "chain"
    assert rows[0].attributes["chain_name"] == "retriever:VectorStoreRetriever"
    assert '"result_count": 2' in rows[0].attributes["output_preview"]


def test_retriever_error_maps_onto_error_chain_event(tmp_path):
    store = SqliteStore(tmp_path / "obyflow.db")
    ctx = FrameworkInstrumentationContext(service="rag-svc", store=store)
    handler = ObyflowLangChainCallbackHandler(ctx)

    token = _traced(store, "trace-6", "req-6")
    try:
        handler.on_retriever_start(
            {"name": "VectorStoreRetriever"}, "q", run_id="ret-2"
        )
        handler.on_retriever_error(RuntimeError("index unreachable"), run_id="ret-2")
    finally:
        reset_trace_context(token)

    rows = store.get_by_trace_id("trace-6")
    assert rows[0].attributes["status"] == "error"
    assert rows[0].severity == "error"


def test_llm_call_captures_model_provider_and_token_usage(tmp_path):
    store = SqliteStore(tmp_path / "obyflow.db")
    ctx = FrameworkInstrumentationContext(service="rag-svc", store=store)
    handler = ObyflowLangChainCallbackHandler(ctx)

    token = _traced(store, "trace-7", "req-7")
    try:
        handler.on_llm_start(
            {"id": ["langchain", "llms", "openai", "OpenAI"]},
            ["Summarize this."],
            run_id="llm-1",
            invocation_params={"model": "gpt-4o-mini"},
        )
        handler.on_llm_end(
            {
                "generations": [[{"generation_info": {"finish_reason": "stop"}}]],
                "llm_output": {
                    "token_usage": {"prompt_tokens": 42, "completion_tokens": 8}
                },
            },
            run_id="llm-1",
        )
    finally:
        reset_trace_context(token)

    rows = store.get_by_trace_id("trace-7")
    assert len(rows) == 1
    assert rows[0].type == "llm_call"
    assert rows[0].attributes["model"] == "gpt-4o-mini"
    assert rows[0].attributes["provider"] == "openai"
    assert rows[0].attributes["prompt_tokens"] == 42
    assert rows[0].attributes["completion_tokens"] == 8
    assert rows[0].attributes["stop_reason"] == "stop"


def test_chat_model_start_captures_model_provider(tmp_path):
    store = SqliteStore(tmp_path / "obyflow.db")
    ctx = FrameworkInstrumentationContext(service="rag-svc", store=store)
    handler = ObyflowLangChainCallbackHandler(ctx)

    token = _traced(store, "trace-8", "req-8")
    try:
        handler.on_chat_model_start(
            {"id": ["langchain", "chat_models", "anthropic", "ChatAnthropic"]},
            [[{"content": "hi"}]],
            run_id="chat-1",
            invocation_params={"model": "claude-sonnet-5"},
        )
        handler.on_llm_end({"generations": [[{}]]}, run_id="chat-1")
    finally:
        reset_trace_context(token)

    rows = store.get_by_trace_id("trace-8")
    assert rows[0].attributes["model"] == "claude-sonnet-5"
    assert rows[0].attributes["provider"] == "anthropic"


def test_llm_error_sets_status_error_and_stop_reason(tmp_path):
    store = SqliteStore(tmp_path / "obyflow.db")
    ctx = FrameworkInstrumentationContext(service="rag-svc", store=store)
    handler = ObyflowLangChainCallbackHandler(ctx)

    token = _traced(store, "trace-9", "req-9")
    try:
        handler.on_llm_start(
            {"id": ["openai", "OpenAI"]},
            ["x"],
            run_id="llm-2",
            invocation_params={"model": "gpt-4o-mini"},
        )
        handler.on_llm_error(RuntimeError("rate limited"), run_id="llm-2")
    finally:
        reset_trace_context(token)

    rows = store.get_by_trace_id("trace-9")
    assert rows[0].attributes["status"] == "error"
    assert "rate limited" in rows[0].attributes["stop_reason"]
    assert rows[0].severity == "error"


def test_nested_run_tree_preserves_run_id_and_parent_run_id(tmp_path):
    store = SqliteStore(tmp_path / "obyflow.db")
    ctx = FrameworkInstrumentationContext(service="rag-svc", store=store)
    handler = ObyflowLangChainCallbackHandler(ctx)

    token = _traced(store, "trace-10", "req-10")
    try:
        handler.on_chain_start({"name": "RetrievalQAChain"}, {}, run_id="root")
        handler.on_retriever_start(
            {"name": "VectorStoreRetriever"},
            "q",
            run_id="child-retriever",
            parent_run_id="root",
        )
        handler.on_retriever_end(
            [{"page_content": "a"}], run_id="child-retriever", parent_run_id="root"
        )
        handler.on_llm_start(
            {"id": ["openai"]},
            ["p"],
            run_id="child-llm",
            parent_run_id="root",
            invocation_params={"model": "gpt-4o-mini"},
        )
        handler.on_llm_end(
            {"generations": [[{}]]}, run_id="child-llm", parent_run_id="root"
        )
        handler.on_chain_end({"answer": "done"}, run_id="root")
    finally:
        reset_trace_context(token)

    rows = {r.attributes["run_id"]: r for r in store.get_by_trace_id("trace-10")}
    assert rows["child-retriever"].attributes["parent_run_id"] == "root"
    assert rows["child-llm"].attributes["parent_run_id"] == "root"
    assert rows["root"].attributes["parent_run_id"] is None


def test_create_langchain_callback_handler_raises_clear_error_when_langchain_core_missing(
    tmp_path, monkeypatch
):
    store = SqliteStore(tmp_path / "obyflow.db")
    monkeypatch.setitem(sys.modules, "langchain_core", None)

    with pytest.raises(ImportError, match="langchain-core"):
        create_langchain_callback_handler(service="rag-svc", store=store)


def test_create_langchain_callback_handler_returns_a_real_base_callback_handler(
    tmp_path,
):
    langchain_core_callbacks_base = pytest.importorskip("langchain_core.callbacks.base")
    store = SqliteStore(tmp_path / "obyflow.db")

    handler = create_langchain_callback_handler(service="rag-svc", store=store)

    assert isinstance(handler, langchain_core_callbacks_base.BaseCallbackHandler)
    assert isinstance(handler, ObyflowLangChainCallbackHandler)

    token = _traced(store, "trace-11", "req-11")
    try:
        handler.on_chain_start({"name": "RetrievalQAChain"}, {}, run_id="run-e2e")
        handler.on_chain_end({"answer": "ok"}, run_id="run-e2e")
    finally:
        reset_trace_context(token)

    rows = store.get_by_trace_id("trace-11")
    assert len(rows) == 1
    assert rows[0].type == "chain"
