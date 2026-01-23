import json
import os

from .logger import logger


def _load_dotenv():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
    dotenv_path = os.path.join(root_dir, ".env")
    if not os.path.isfile(dotenv_path):
        return
    try:
        with open(dotenv_path, "r", encoding="utf-8") as handle:
            for line in handle:
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                if stripped.startswith("export "):
                    stripped = stripped[7:].strip()
                if "=" not in stripped:
                    logger.warning("Skipping invalid .env line: %s", stripped)
                    continue
                key, value = stripped.split("=", 1)
                key = key.strip()
                value = value.strip()
                if not key:
                    continue
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {"\"", "'"}:
                    value = value[1:-1]
                os.environ.setdefault(key, value)
    except OSError as exc:
        logger.warning("Failed to load .env file %s: %s", dotenv_path, exc)


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


_load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = _normalize_base_url(
    os.getenv("OPENAI_BASE_URL", "https://api.openai.com")
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
