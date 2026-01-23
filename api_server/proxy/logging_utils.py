import json
import time

from flask import g, request

from .config import (
    LOG_MAX_CHARS,
    LOG_PAYLOAD_MAX_CHARS,
    LOG_PAYLOAD_MAX_DEPTH,
    LOG_PAYLOAD_MAX_ITEMS,
    LOG_PAYLOADS,
    LOG_STREAM_EVENTS,
    LOG_TOOL_CALLS,
)
from .logger import logger


def _truncate_log(value):
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    if len(text) <= LOG_MAX_CHARS:
        return text
    return f"{text[:LOG_MAX_CHARS]}...<truncated>"


def _truncate_payload(value):
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    if len(text) <= LOG_PAYLOAD_MAX_CHARS:
        return text
    return f"{text[:LOG_PAYLOAD_MAX_CHARS]}...<truncated>"


def _safe_json_dumps(value):
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)


def _summarize_payload(value, depth=0):
    if depth >= LOG_PAYLOAD_MAX_DEPTH:
        return "<max_depth>"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _truncate_payload(value)
    if isinstance(value, bytes):
        return f"<bytes:{len(value)}>"
    if isinstance(value, dict):
        result = {}
        items = list(value.items())
        for idx, (key, val) in enumerate(items):
            if idx >= LOG_PAYLOAD_MAX_ITEMS:
                result["<truncated_keys>"] = len(items) - LOG_PAYLOAD_MAX_ITEMS
                break
            result[str(key)] = _summarize_payload(val, depth + 1)
        return result
    if isinstance(value, (list, tuple)):
        items = list(value)
        summarized = [_summarize_payload(item, depth + 1) for item in items[:LOG_PAYLOAD_MAX_ITEMS]]
        if len(items) > LOG_PAYLOAD_MAX_ITEMS:
            summarized.append(f"<truncated_items:{len(items) - LOG_PAYLOAD_MAX_ITEMS}>")
        return summarized
    return _truncate_payload(str(value))


def _log_payload(label, payload):
    if not LOG_PAYLOADS:
        return
    summarized = _summarize_payload(payload)
    text = _safe_json_dumps(summarized)
    logger.info("%s=%s", label, _truncate_payload(text))


def _log_stream_event(label, payload):
    if not LOG_STREAM_EVENTS:
        return
    summarized = _summarize_payload(payload)
    text = _safe_json_dumps(summarized)
    logger.info("event.%s=%s", label, _truncate_payload(text))


def _log_tool_call(name, arguments, call_id, source):
    if not LOG_TOOL_CALLS:
        return
    logger.info(
        "Tool call (%s) name=%s call_id=%s arguments=%s",
        source,
        name,
        call_id,
        _truncate_log(arguments),
    )


def _log_request_complete(status_code, stream=False):
    start_time = getattr(g, "start_time", None)
    duration_ms = (time.time() - start_time) * 1000.0 if start_time else 0.0
    logger.info(
        "request.complete request_id=%s method=%s path=%s status=%s duration_ms=%.2f stream=%s",
        getattr(g, "request_id", None),
        request.method,
        request.path,
        status_code,
        duration_ms,
        stream,
    )
