import json
import time
import uuid

from .config import PROXY_TOOL_SCHEMA_OVERRIDES, _DEFAULT_TOOL_SCHEMAS
from .logging_utils import _log_tool_call


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


def _ensure_json_str(value, default=""):
    if value is None:
        return default
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except TypeError:
        return str(value)


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
        from .logger import logger

        logger.warning("Responses API does not support n; ignoring.")
        data.pop("n", None)

    return data


def _apply_param_rules(payload):
    from .config import OPENAI_PARAM_DEFAULTS, OPENAI_PARAM_DROP, OPENAI_PARAM_OVERRIDES

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
