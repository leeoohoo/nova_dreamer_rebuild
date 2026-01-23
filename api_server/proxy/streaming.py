import json
import time
import uuid

from .config import LOG_TOOL_CALLS
from .logging_utils import _log_stream_event, _log_tool_call
from .logger import logger
from .errors import _stream_error_payload
from .normalize import _ensure_json_str, _serialize_model


def _chat_completion_chunk(response_id, model, created, delta, finish_reason=None):
    try:
        created_at = int(created) if created is not None else int(time.time())
    except (TypeError, ValueError):
        created_at = int(time.time())
    return {
        "id": response_id or f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion.chunk",
        "created": created_at,
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": delta,
                "finish_reason": finish_reason,
            }
        ],
    }


def _stream_chat_sse(event_iter):
    response_id = None
    fallback_id = f"chatcmpl-{uuid.uuid4().hex}"
    model = None
    created = None
    call_id_by_output_index = {}
    name_by_output_index = {}
    call_index_by_id = {}
    args_by_call_id = {}
    name_by_call_id = {}
    sent_args_by_output_index = set()
    saw_tool_calls = False
    saw_text = False

    for event in event_iter:
        data = _serialize_model(event)
        if not isinstance(data, dict):
            continue
        event_type = data.get("type")

        if event_type == "response.created":
            response = data.get("response") or {}
            if isinstance(response, dict):
                response_id = response.get("id") or response_id
                model = response.get("model") or model
                created = response.get("created") or response.get("created_at") or created
            continue

        if event_type == "response.output_item.added":
            item = data.get("item") or {}
            output_index = data.get("output_index")
            if isinstance(item, dict) and item.get("type") in {"function_call", "mcp_call"}:
                _log_stream_event(
                    "output_item.added",
                    {"output_index": output_index, "item": item},
                )
                call_id = item.get("call_id") or item.get("id")
                name = item.get("name")
                arguments = _ensure_json_str(item.get("arguments"), "")
                if output_index is not None and call_id:
                    call_id_by_output_index[output_index] = call_id
                    name_by_output_index[output_index] = name
                    if call_id:
                        name_by_call_id[call_id] = name
                if call_id:
                    if call_id not in call_index_by_id:
                        call_index_by_id[call_id] = len(call_index_by_id)
                    index = call_index_by_id[call_id]
                    saw_tool_calls = True
                    if arguments:
                        args_by_call_id[call_id] = arguments
                    chunk = _chat_completion_chunk(
                        response_id or fallback_id,
                        model,
                        created,
                        {
                            "tool_calls": [
                                {
                                    "index": index,
                                    "id": call_id,
                                    "type": "function",
                                    "function": {
                                        "name": name,
                                        "arguments": arguments,
                                    },
                                }
                            ]
                        },
                    )
                    yield f"data: {json.dumps(chunk)}\n\n"
                    if output_index is not None and arguments:
                        sent_args_by_output_index.add(output_index)
            continue

        if event_type == "response.function_call_arguments.delta":
            output_index = data.get("output_index")
            delta_args = _ensure_json_str(data.get("delta"), "")
            _log_stream_event(
                "function_call_arguments.delta",
                {"output_index": output_index, "delta": delta_args, "item_id": data.get("item_id")},
            )
            call_id = call_id_by_output_index.get(output_index)
            name = name_by_output_index.get(output_index)
            if call_id:
                if call_id not in call_index_by_id:
                    call_index_by_id[call_id] = len(call_index_by_id)
                index = call_index_by_id[call_id]
                saw_tool_calls = True
                if delta_args:
                    args_by_call_id[call_id] = args_by_call_id.get(call_id, "") + delta_args
                chunk = _chat_completion_chunk(
                    response_id or fallback_id,
                    model,
                    created,
                    {
                        "tool_calls": [
                            {
                                "index": index,
                                "id": call_id,
                                "type": "function",
                                "function": {
                                    "name": name,
                                    "arguments": delta_args,
                                },
                            }
                        ]
                    },
                )
                yield f"data: {json.dumps(chunk)}\n\n"
                if output_index is not None and delta_args:
                    sent_args_by_output_index.add(output_index)
            continue

        if event_type == "response.function_call_arguments.done":
            output_index = data.get("output_index")
            done_args = _ensure_json_str(data.get("arguments"), "")
            _log_stream_event(
                "function_call_arguments.done",
                {"output_index": output_index, "arguments": done_args, "item_id": data.get("item_id")},
            )
            if output_index in sent_args_by_output_index:
                continue
            call_id = call_id_by_output_index.get(output_index)
            if not call_id:
                call_id = data.get("item_id")
            if not call_id:
                call_id = f"call_{len(call_index_by_id) + 1}"
            name = name_by_output_index.get(output_index) or data.get("name")
            if call_id and name:
                name_by_call_id[call_id] = name
            if call_id not in call_index_by_id:
                call_index_by_id[call_id] = len(call_index_by_id)
            index = call_index_by_id[call_id]
            saw_tool_calls = True
            if done_args:
                args_by_call_id[call_id] = done_args
            chunk = _chat_completion_chunk(
                response_id or fallback_id,
                model,
                created,
                {
                    "tool_calls": [
                        {
                            "index": index,
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": done_args,
                            },
                        }
                    ]
                },
            )
            yield f"data: {json.dumps(chunk)}\n\n"
            if output_index is not None and done_args:
                sent_args_by_output_index.add(output_index)
            continue

        if event_type == "response.mcp_call_arguments.delta":
            output_index = data.get("output_index")
            delta_args = _ensure_json_str(data.get("delta"), "")
            _log_stream_event(
                "mcp_call_arguments.delta",
                {"output_index": output_index, "delta": delta_args, "item_id": data.get("item_id")},
            )
            call_id = call_id_by_output_index.get(output_index) or data.get("item_id")
            name = name_by_output_index.get(output_index) or name_by_call_id.get(call_id)
            if call_id:
                if call_id not in call_index_by_id:
                    call_index_by_id[call_id] = len(call_index_by_id)
                index = call_index_by_id[call_id]
                saw_tool_calls = True
                if delta_args:
                    args_by_call_id[call_id] = args_by_call_id.get(call_id, "") + delta_args
                chunk = _chat_completion_chunk(
                    response_id or fallback_id,
                    model,
                    created,
                    {
                        "tool_calls": [
                            {
                                "index": index,
                                "id": call_id,
                                "type": "function",
                                "function": {
                                    "name": name,
                                    "arguments": delta_args,
                                },
                            }
                        ]
                    },
                )
                yield f"data: {json.dumps(chunk)}\n\n"
                if output_index is not None and delta_args:
                    sent_args_by_output_index.add(output_index)
            continue

        if event_type == "response.mcp_call_arguments.done":
            output_index = data.get("output_index")
            done_args = _ensure_json_str(data.get("arguments"), "")
            _log_stream_event(
                "mcp_call_arguments.done",
                {"output_index": output_index, "arguments": done_args, "item_id": data.get("item_id")},
            )
            if output_index in sent_args_by_output_index:
                continue
            call_id = call_id_by_output_index.get(output_index) or data.get("item_id")
            if not call_id:
                call_id = f"call_{len(call_index_by_id) + 1}"
            name = name_by_output_index.get(output_index) or name_by_call_id.get(call_id)
            if call_id and name:
                name_by_call_id[call_id] = name
            if call_id not in call_index_by_id:
                call_index_by_id[call_id] = len(call_index_by_id)
            index = call_index_by_id[call_id]
            saw_tool_calls = True
            if done_args:
                args_by_call_id[call_id] = done_args
            chunk = _chat_completion_chunk(
                response_id or fallback_id,
                model,
                created,
                {
                    "tool_calls": [
                        {
                            "index": index,
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": done_args,
                            },
                        }
                    ]
                },
            )
            yield f"data: {json.dumps(chunk)}\n\n"
            if output_index is not None and done_args:
                sent_args_by_output_index.add(output_index)
            continue

        if event_type == "response.output_text.delta":
            text_delta = _ensure_json_str(data.get("delta"), "")
            if text_delta:
                saw_text = True
                chunk = _chat_completion_chunk(
                    response_id or fallback_id,
                    model,
                    created,
                    {"content": text_delta},
                )
                yield f"data: {json.dumps(chunk)}\n\n"
            continue

        if event_type == "response.output_text.done":
            if saw_text:
                continue
            text_done = _ensure_json_str(data.get("text"), "")
            if text_done:
                saw_text = True
                chunk = _chat_completion_chunk(
                    response_id or fallback_id,
                    model,
                    created,
                    {"content": text_done},
                )
                yield f"data: {json.dumps(chunk)}\n\n"
            continue

        if event_type == "response.completed":
            finish_reason = "tool_calls" if saw_tool_calls else "stop"
            if saw_tool_calls and LOG_TOOL_CALLS:
                for call_id, args in args_by_call_id.items():
                    name = name_by_call_id.get(call_id)
                    _log_tool_call(name, args, call_id, "responses.stream")
            chunk = _chat_completion_chunk(
                response_id or fallback_id,
                model,
                created,
                {},
                finish_reason=finish_reason,
            )
            yield f"data: {json.dumps(chunk)}\n\n"
            break

    yield "data: [DONE]\n\n"


def _stream_sse(event_iter):
    for event in event_iter:
        data = _serialize_model(event)
        yield f"data: {json.dumps(data)}\n\n"
    yield "data: [DONE]\n\n"


def _safe_stream(generator, request_id, start_time, method, path):
    status = 200
    try:
        for chunk in generator:
            yield chunk
    except Exception as exc:
        if isinstance(exc, (BrokenPipeError, ConnectionResetError)):
            status = 499
            logger.info(
                "Stream client disconnect request_id=%s method=%s path=%s",
                request_id,
                method,
                path,
            )
            return
        payload, status = _stream_error_payload(exc)
        logger.exception(
            "Stream error request_id=%s method=%s path=%s status=%s",
            request_id,
            method,
            path,
            status,
        )
        yield f"data: {json.dumps(payload)}\n\n"
        yield "data: [DONE]\n\n"
    finally:
        duration_ms = (time.time() - start_time) * 1000.0 if start_time else 0.0
        logger.info(
            "request.complete request_id=%s method=%s path=%s status=%s duration_ms=%.2f stream=True",
            request_id,
            method,
            path,
            status,
            duration_ms,
        )
