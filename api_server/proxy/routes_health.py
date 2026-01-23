from flask import jsonify

from .config import ALLOW_UNAUTHENTICATED_HEALTH
from .routes_auth import _authorize_request


def register_health_routes(app):
    @app.get("/v1/health")
    def health():
        _, auth_error = _authorize_request(allow_unauthenticated=ALLOW_UNAUTHENTICATED_HEALTH)
        if auth_error:
            return auth_error
        return jsonify({"status": "ok"})
