import time
import uuid

from flask import Response, g, jsonify, request, stream_with_context

from .client import _get_client, _resolve_upstream_key
from .errors import _error, _handle_upstream_error
from .logger import logger
from .logging_utils import _log_payload
from .normalize import (
    _apply_param_rules,
    _normalize_chat_payload_for_responses,
    _responses_to_chat_completion,
    _serialize_model,
)
from .routes_auth import _authorize_request
from .streaming import _safe_stream, _stream_chat_sse, _stream_sse


def register_chat_routes(app):
    @app.post("/v1/chat/completions")
    def create_responses():
        token, auth_error = _authorize_request()
        if auth_error:
            return auth_error
        payload = request.get_json(silent=True)
        if payload is None:
            return _error("Invalid or missing JSON body.", status=400, error_type="invalid_request_error")
        return_chat = isinstance(payload, dict) and "messages" in payload
        _log_payload("incoming.raw", payload)
        payload = _normalize_chat_payload_for_responses(payload)
        _log_payload("incoming.normalized", payload)
        _log_payload("incoming.input_summary", payload.get("input") if isinstance(payload, dict) else None)
        payload = _apply_param_rules(payload)
        _log_payload("incoming.final", payload)
        stream = bool(payload.pop("stream", False))
        from .config import LOG_PAYLOADS

        if LOG_PAYLOADS:
            logger.info("outgoing.stream=%s", stream)
            _log_payload("outgoing.payload", payload)
        try:
            client = _get_client(_resolve_upstream_key(token))
            if stream:
                stream_iter = client.responses.create(**payload, stream=True)
                request_id = getattr(g, "request_id", uuid.uuid4().hex)
                start_time = getattr(g, "start_time", time.time())
                stream_generator = _stream_chat_sse(stream_iter) if return_chat else _stream_sse(stream_iter)
                safe_stream = _safe_stream(stream_generator, request_id, start_time, request.method, request.path)
                return Response(
                    stream_with_context(safe_stream),
                    mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache"},
                )
            response = client.responses.create(**payload)
            if return_chat:
                return jsonify(_responses_to_chat_completion(response))
            return jsonify(_serialize_model(response))
        except Exception as exc:  # pragma: no cover - best effort to normalize upstream errors
            logger.exception("Upstream error on /v1/responses.")
            return _handle_upstream_error(exc)

    @app.post("/v1/chat/completions1")
    def create_chat_completions():
        token, auth_error = _authorize_request()
        if auth_error:
            return auth_error
        payload = request.get_json(silent=True)
        if payload is None:
            return _error("Invalid or missing JSON body.", status=400, error_type="invalid_request_error")
        if "reasoning_effort" in payload:
            logger.warning("Chat Completions does not support reasoning_effort; ignoring.")
            payload.pop("reasoning_effort", None)
        payload = _apply_param_rules(payload)
        stream = bool(payload.pop("stream", False))
        try:
            client = _get_client(_resolve_upstream_key(token))
            if stream:
                stream_iter = client.chat.completions.create(**payload, stream=True)
                request_id = getattr(g, "request_id", uuid.uuid4().hex)
                start_time = getattr(g, "start_time", time.time())
                safe_stream = _safe_stream(_stream_sse(stream_iter), request_id, start_time, request.method, request.path)
                return Response(
                    stream_with_context(safe_stream),
                    mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache"},
                )
            response = client.chat.completions.create(**payload)
            return jsonify(_serialize_model(response))
        except Exception as exc:  # pragma: no cover - best effort to normalize upstream errors
            logger.exception("Upstream error on /v1/chat/completions.")
            return _handle_upstream_error(exc)
