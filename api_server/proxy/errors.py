import json

from flask import jsonify

from .logger import logger


def _error_payload(message, error_type="proxy_error", code=None, param=None):
    payload = {"error": {"message": message, "type": error_type}}
    if code is not None:
        payload["error"]["code"] = code
    if param is not None:
        payload["error"]["param"] = param
    return payload


def _error(message, status=400, error_type="proxy_error", code=None, param=None):
    payload = _error_payload(message, error_type=error_type, code=code, param=param)
    return jsonify(payload), status


def _stream_error_payload(error):
    status = getattr(error, "status_code", 500)
    body = getattr(error, "body", None)
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except json.JSONDecodeError:
            body = None
    if isinstance(body, dict):
        return body, status
    message = getattr(error, "message", None) or str(error)
    return _error_payload(message, error_type="upstream_error"), status


def _handle_upstream_error(error):
    payload, status = _stream_error_payload(error)
    return jsonify(payload), status
