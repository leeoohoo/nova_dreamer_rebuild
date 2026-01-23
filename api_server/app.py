import json
import logging
import os
import time
import uuid

from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS
from openai import OpenAI


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("openai-proxy")


def _bool_env(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _json_env(name, default):
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Invalid JSON in %s, using default.", name)
        return default


def _normalize_base_url(base_url):
    trimmed = base_url.rstrip("/")
    if not trimmed.endswith("/v1"):
        trimmed = f"{trimmed}/v1"
    return trimmed


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "sk-ant-sid01--755be09a1ffba426ab33402481798b1a2676e29019a500b1a83e5e7e759c2fed")
OPENAI_BASE_URL = _normalize_base_url(
    os.getenv("OPENAI_BASE_URL", "https://relay.nf.video")
)
OPENAI_TIMEOUT = float(os.getenv("OPENAI_TIMEOUT", "120"))
OPENAI_MAX_RETRIES = int(os.getenv("OPENAI_MAX_RETRIES", "2"))
OPENAI_ORGANIZATION = os.getenv("OPENAI_ORGANIZATION")
OPENAI_PROJECT = os.getenv("OPENAI_PROJECT")

PROXY_REQUIRE_API_KEY = _bool_env("PROXY_REQUIRE_API_KEY", False)
PROXY_API_KEYS = [
    key.strip() for key in os.getenv("PROXY_API_KEYS", "").split(",") if key.strip()
]
PROXY_FORWARD_AUTH_HEADER = _bool_env("PROXY_FORWARD_AUTH_HEADER", False)
ALLOW_UNAUTHENTICATED_HEALTH = _bool_env("ALLOW_UNAUTHENTICATED_HEALTH", False)
LOG_TOOL_CALLS = _bool_env("PROXY_LOG_TOOL_CALLS", False)
try:
    LOG_MAX_CHARS = int(os.getenv("PROXY_LOG_MAX_CHARS", "2000"))
except ValueError:
    LOG_MAX_CHARS = 2000
LOG_PAYLOADS = _bool_env("PROXY_LOG_PAYLOADS", False)
try:
    LOG_PAYLOAD_MAX_CHARS = int(os.getenv("PROXY_LOG_PAYLOAD_MAX_CHARS", "4000"))
except ValueError:
    LOG_PAYLOAD_MAX_CHARS = 4000
try:
    LOG_PAYLOAD_MAX_ITEMS = int(os.getenv("PROXY_LOG_PAYLOAD_MAX_ITEMS", "50"))
except ValueError:
    LOG_PAYLOAD_MAX_ITEMS = 50
try:
    LOG_PAYLOAD_MAX_DEPTH = int(os.getenv("PROXY_LOG_PAYLOAD_MAX_DEPTH", "6"))
except ValueError:
    LOG_PAYLOAD_MAX_DEPTH = 6
LOG_STREAM_EVENTS = _bool_env("PROXY_LOG_STREAM_EVENTS", False)

OPENAI_PARAM_DEFAULTS = _json_env("OPENAI_PARAM_DEFAULTS", {})
OPENAI_PARAM_OVERRIDES = _json_env("OPENAI_PARAM_OVERRIDES", {})
OPENAI_PARAM_DROP = {
    key.strip()
    for key in os.getenv("OPENAI_PARAM_DROP", "").split(",")
    if key.strip()
}
PROXY_TOOL_SCHEMA_OVERRIDES = _json_env("PROXY_TOOL_SCHEMA_OVERRIDES", {})

_TASK_MANAGER_ADD_TASK_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "Task title."},
        "details": {"type": "string", "description": "Background and acceptance criteria."},
        "priority": {"type": "string", "enum": ["high", "medium", "low"]},
        "tags": {"type": "array", "items": {"type": "string"}},
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Task title."},
                    "details": {
                        "type": "string",
                        "description": "Background and acceptance criteria.",
                    },
                    "priority": {"type": "string", "enum": ["high", "medium", "low"]},
                    "tags": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["title", "details"],
                "additionalProperties": False,
            },
        },
    },
    "additionalProperties": False,
}
_DEFAULT_TOOL_SCHEMAS = {
    "mcp_task_manager_add_task": _TASK_MANAGER_ADD_TASK_SCHEMA,
}

CLIENT_CACHE = {}


def _get_client(api_key):
    client = CLIENT_CACHE.get(api_key)
    if client is None:
        client = OpenAI(
            api_key=api_key,
            base_url=OPENAI_BASE_URL,
            timeout=OPENAI_TIMEOUT,
            max_retries=OPENAI_MAX_RETRIES,
            organization=OPENAI_ORGANIZATION,
            project=OPENAI_PROJECT,
        )
        CLIENT_CACHE[api_key] = client
    return client


def _extract_bearer_token():
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def _error(message, status=400, error_type="proxy_error", code=None, param=None):
    payload = {"error": {"message": message, "type": error_type}}
    if code is not None:
        payload["error"]["code"] = code
    if param is not None:
        payload["error"]["param"] = param
    return jsonify(payload), status


def _authorize_request(allow_unauthenticated=False):
    token = _extract_bearer_token()
    if not PROXY_REQUIRE_API_KEY or allow_unauthenticated:
        return token, None
    if not PROXY_API_KEYS:
        return token, _error(
            "Proxy API keys are not configured.",
            status=500,
            error_type="config_error",
        )
    if not token:
        return token, _error("Missing Authorization header.", status=401, error_type="auth_error")
    if token not in PROXY_API_KEYS:
        return token, _error("Invalid API key.", status=403, error_type="auth_error")
    return token, None


def _resolve_upstream_key(incoming_token):
    if PROXY_FORWARD_AUTH_HEADER:
        if not incoming_token:
            raise ValueError("Missing Authorization header for upstream forwarding.")
        return incoming_token
    if OPENAI_API_KEY:
        return OPENAI_API_KEY
    raise ValueError("OPENAI_API_KEY is not set.")

def _schema_is_empty(schema):
    if schema is None:
        return True
    if not isinstance(schema, dict):
        return False
    if not schema:
        return True
    if schema.get("type") != "object":
        return False
    if schema.get("properties"):
        return False
    if schema.get("required"):
        return False
    if schema.get("anyOf") or schema.get("oneOf") or schema.get("allOf"):
        return False
    if schema.get("items") or schema.get("$ref") or schema.get("enum"):
        return False
    return True


def _get_tool_schema_override(name):
    if not name:
        return None
    override = PROXY_TOOL_SCHEMA_OVERRIDES.get(name)
    if isinstance(override, dict) and override:
        return override
    return _DEFAULT_TOOL_SCHEMAS.get(name)


def _normalize_tool_definitions(tools):
    normalized = []
    for tool in tools or []:
        if not isinstance(tool, dict):
            normalized.append(tool)
            continue
        tool_data = dict(tool)
        function = tool_data.pop("function", None)
        mcp = tool_data.pop("mcp", None)
        if isinstance(function, dict):
            tool_data.update(function)
            tool_data["type"] = tool.get("type", "function") or "function"
        if isinstance(mcp, dict):
            for key, value in mcp.items():
                if key == "input_schema" and _schema_is_empty(tool_data.get("input_schema")):
                    tool_data[key] = value
                else:
                    tool_data.setdefault(key, value)
            if "type" not in tool_data:
                tool_data["type"] = tool.get("type", "mcp") or "mcp"
        tool_type = tool_data.get("type", "function")
        if tool_type == "function":
            if _schema_is_empty(tool_data.get("parameters")):
                override = _get_tool_schema_override(tool_data.get("name"))
                if override:
                    tool_data["parameters"] = override
                else:
                    candidate = tool_data.get("input_schema") or tool_data.get("schema")
                    if isinstance(candidate, dict) and candidate:
                        tool_data["parameters"] = candidate
        elif tool_type == "mcp":
            if _schema_is_empty(tool_data.get("input_schema")):
                candidate = tool_data.get("parameters") or tool_data.get("schema")
                if isinstance(candidate, dict) and candidate:
                    tool_data["input_schema"] = candidate
        normalized.append(tool_data)
    return normalized


def _convert_chat_messages_to_responses_input(messages):
    input_items = []
    call_id_by_name = {}
    call_id_counter = 0

    def next_call_id():
        nonlocal call_id_counter
        call_id_counter += 1
        return f"call_{call_id_counter}"

    for msg in messages or []:
        if not isinstance(msg, dict):
            input_items.append(msg)
            continue

        role = msg.get("role")
        tool_calls = msg.get("tool_calls")
        if tool_calls:
            content = msg.get("content")
            if content:
                input_items.append({"role": "assistant", "content": content})
            for call in tool_calls:
                if not isinstance(call, dict):
                    continue
                call_id = call.get("id") or call.get("call_id") or next_call_id()
                func = call.get("function") or {}
                name = func.get("name") or call.get("name")
                arguments = func.get("arguments") or call.get("arguments") or "{}"
                arguments = _ensure_json_str(arguments, "{}")
                input_items.append(
                    {
                        "type": "function_call",
                        "call_id": call_id,
                        "name": name,
                        "arguments": arguments,
                    }
                )
                if name:
                    call_id_by_name[name] = call_id
            continue

        function_call = msg.get("function_call")
        if function_call:
            content = msg.get("content")
            if content:
                input_items.append({"role": "assistant", "content": content})
            if isinstance(function_call, dict):
                name = function_call.get("name")
                arguments = function_call.get("arguments") or "{}"
                arguments = _ensure_json_str(arguments, "{}")
                call_id = next_call_id()
                input_items.append(
                    {
                        "type": "function_call",
                        "call_id": call_id,
                        "name": name,
                        "arguments": arguments,
                    }
                )
                if name:
                    call_id_by_name[name] = call_id
            continue

        if role in {"tool", "function"}:
            call_id = msg.get("tool_call_id")
            if not call_id and msg.get("name"):
                call_id = call_id_by_name.get(msg["name"])
            if not call_id:
                call_id = next_call_id()
            output = msg.get("content")
            if output is None:
                output = ""
            if not isinstance(output, str):
                output = json.dumps(output, ensure_ascii=False)
            input_items.append(
                {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": output,
                }
            )
            continue

        item = {"role": role, "content": msg.get("content")}
        if "name" in msg:
            item["name"] = msg["name"]
        if "metadata" in msg:
            item["metadata"] = msg["metadata"]
        input_items.append(item)

    return input_items


def _normalize_chat_payload_for_responses(payload):
    if not isinstance(payload, dict):
        return payload

    data = dict(payload)

    if "messages" in data and "input" not in data:
        messages = data.get("messages")
        if isinstance(messages, list):
            data["input"] = _convert_chat_messages_to_responses_input(messages)
        else:
            data["input"] = messages
    data.pop("messages", None)

    if "functions" in data and "tools" not in data:
        functions = data.get("functions") or []
        tools = []
        for fn in functions:
            if isinstance(fn, dict):
                tool = dict(fn)
                tool.setdefault("type", "function")
                tools.append(tool)
        data["tools"] = tools
    data.pop("functions", None)

    if "tools" in data:
        data["tools"] = _normalize_tool_definitions(data.get("tools"))

    if "function_call" in data and "tool_choice" not in data:
        function_call = data.get("function_call")
        if isinstance(function_call, str):
            data["tool_choice"] = function_call
        elif isinstance(function_call, dict):
            name = function_call.get("name")
            if name:
                data["tool_choice"] = {"type": "function", "name": name}
    data.pop("function_call", None)

    tool_choice = data.get("tool_choice")
    if isinstance(tool_choice, dict) and isinstance(tool_choice.get("function"), dict):
        name = tool_choice["function"].get("name")
        data["tool_choice"] = {"type": tool_choice.get("type", "function"), "name": name}

    if "max_tokens" in data and "max_output_tokens" not in data:
        data["max_output_tokens"] = data.get("max_tokens")
    data.pop("max_tokens", None)

    if "reasoning_effort" in data:
        effort = data.get("reasoning_effort")
        reasoning = data.get("reasoning")
        if isinstance(reasoning, dict):
            reasoning.setdefault("effort", effort)
            data["reasoning"] = reasoning
        else:
            data["reasoning"] = {"effort": effort}
        data.pop("reasoning_effort", None)

    if "n" in data:
        logger.warning("Responses API does not support n; ignoring.")
        data.pop("n", None)

    return data


def _apply_param_rules(payload):
    data = dict(payload or {})
    for key in OPENAI_PARAM_DROP:
        data.pop(key, None)
    for key, value in OPENAI_PARAM_DEFAULTS.items():
        data.setdefault(key, value)
    for key, value in OPENAI_PARAM_OVERRIDES.items():
        data[key] = value
    return data


def _serialize_model(obj):
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "dict"):
        return obj.dict()
    return obj


def _content_to_text(content):
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        if "text" in content:
            return str(content.get("text") or "")
        if "refusal" in content:
            return str(content.get("refusal") or "")
        if "content" in content:
            return str(content.get("content") or "")
        return ""
    if isinstance(content, list):
        parts = []
        for item in content:
            parts.append(_content_to_text(item))
        return "".join(parts)
    return str(content)


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


def _ensure_json_str(value, default=""):
    if value is None:
        return default
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except TypeError:
        return str(value)


def _responses_usage_to_chat(usage):
    if not isinstance(usage, dict):
        return None
    input_tokens = usage.get("input_tokens")
    output_tokens = usage.get("output_tokens")
    total_tokens = usage.get("total_tokens")
    if input_tokens is None and output_tokens is None and total_tokens is None:
        return None
    return {
        "prompt_tokens": input_tokens or 0,
        "completion_tokens": output_tokens or 0,
        "total_tokens": total_tokens or 0,
    }


def _responses_to_chat_completion(response):
    data = _serialize_model(response)
    if not isinstance(data, dict):
        return data

    output_items = data.get("output") or []
    content_text = []
    tool_calls = []

    for item in output_items:
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type == "message":
            content_text.append(_content_to_text(item.get("content")))
        elif item_type in {"function_call", "mcp_call"}:
            call_id = item.get("call_id") or item.get("id") or f"call_{len(tool_calls) + 1}"
            name = item.get("name")
            arguments = _ensure_json_str(item.get("arguments"), "{}")
            tool_calls.append(
                {
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": arguments,
                    },
                }
            )
            _log_tool_call(name, arguments, call_id, "responses")

    if not content_text and data.get("output_text"):
        content_text.append(str(data.get("output_text")))

    message = {
        "role": "assistant",
        "content": "".join(content_text) if content_text else None,
    }
    if tool_calls:
        message["tool_calls"] = tool_calls
        if not content_text:
            message["content"] = None

    created_at = data.get("created") or data.get("created_at")
    try:
        created_at = int(created_at) if created_at is not None else int(time.time())
    except (TypeError, ValueError):
        created_at = int(time.time())

    finish_reason = "tool_calls" if tool_calls else "stop"
    result = {
        "id": data.get("id") or f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": created_at,
        "model": data.get("model"),
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": finish_reason,
            }
        ],
    }
    usage = _responses_usage_to_chat(data.get("usage"))
    if usage:
        result["usage"] = usage
    return result


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


def _handle_upstream_error(error):
    status = getattr(error, "status_code", 500)
    body = getattr(error, "body", None)
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except json.JSONDecodeError:
            body = None
    if isinstance(body, dict):
        return jsonify(body), status
    message = getattr(error, "message", None) or str(error)
    return _error(message, status=status, error_type="upstream_error")


app = Flask(__name__)
app.url_map.strict_slashes = False
CORS(app)


@app.get("/v1/health")
def health():
    _, auth_error = _authorize_request(allow_unauthenticated=ALLOW_UNAUTHENTICATED_HEALTH)
    if auth_error:
        return auth_error
    return jsonify({"status": "ok"})


@app.get("/v1/models")
def list_models():
    token, auth_error = _authorize_request()
    if auth_error:
        return auth_error
    try:
        client = _get_client(_resolve_upstream_key(token))
        models = client.models.list()
        return jsonify(_serialize_model(models))
    except Exception as exc:  # pragma: no cover - best effort to normalize upstream errors
        logger.exception("Upstream error on /v1/models.")
        return _handle_upstream_error(exc)


def _stream_sse(event_iter):
    for event in event_iter:
        data = _serialize_model(event)
        yield f"data: {json.dumps(data)}\n\n"
    yield "data: [DONE]\n\n"


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
    if LOG_PAYLOADS:
        logger.info("outgoing.stream=%s", stream)
        _log_payload("outgoing.payload", payload)
    try:
        client = _get_client(_resolve_upstream_key(token))
        if stream:
            stream_iter = client.responses.create(**payload, stream=True)
            return Response(
                stream_with_context(_stream_chat_sse(stream_iter) if return_chat else _stream_sse(stream_iter)),
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
            return Response(
                stream_with_context(_stream_sse(stream_iter)),
                mimetype="text/event-stream",
                headers={"Cache-Control": "no-cache"},
            )
        response = client.chat.completions.create(**payload)
        return jsonify(_serialize_model(response))
    except Exception as exc:  # pragma: no cover - best effort to normalize upstream errors
        logger.exception("Upstream error on /v1/chat/completions.")
        return _handle_upstream_error(exc)


if __name__ == "__main__":
    host = os.getenv("PROXY_HOST", "0.0.0.0")
    port = int(os.getenv("PROXY_PORT", "8000"))
    logger.info("Starting proxy on %s:%s (upstream=%s)", host, port, OPENAI_BASE_URL)
    app.run(host=host, port=port)
