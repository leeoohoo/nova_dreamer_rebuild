from openai import OpenAI

from .config import (
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENAI_MAX_RETRIES,
    OPENAI_ORGANIZATION,
    OPENAI_PROJECT,
    OPENAI_TIMEOUT,
    PROXY_FORWARD_AUTH_HEADER,
)

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


def _resolve_upstream_key(incoming_token):
    if PROXY_FORWARD_AUTH_HEADER:
        if not incoming_token:
            raise ValueError("Missing Authorization header for upstream forwarding.")
        return incoming_token
    if OPENAI_API_KEY:
        return OPENAI_API_KEY
    raise ValueError("OPENAI_API_KEY is not set.")
