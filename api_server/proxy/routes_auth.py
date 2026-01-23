from flask import request

from .config import PROXY_API_KEYS, PROXY_REQUIRE_API_KEY
from .errors import _error


def _extract_bearer_token():
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


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
