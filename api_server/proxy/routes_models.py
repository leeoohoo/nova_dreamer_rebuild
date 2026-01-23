from flask import jsonify

from .client import _get_client, _resolve_upstream_key
from .errors import _handle_upstream_error
from .logger import logger
from .normalize import _serialize_model
from .routes_auth import _authorize_request


def register_model_routes(app):
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
