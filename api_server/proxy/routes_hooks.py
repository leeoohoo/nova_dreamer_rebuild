import time
import uuid

from flask import g, request
from werkzeug.exceptions import HTTPException

from .errors import _error
from .logger import logger
from .logging_utils import _log_request_complete


def register_request_hooks(app):
    @app.before_request
    def _start_request():
        request_id = request.headers.get("X-Request-ID") or request.headers.get("X-Request-Id")
        if not request_id:
            request_id = uuid.uuid4().hex
        g.request_id = request_id
        g.start_time = time.time()

    @app.after_request
    def _finalize_request(response):
        request_id = getattr(g, "request_id", None)
        if request_id:
            response.headers.setdefault("X-Request-ID", request_id)
        if not response.is_streamed:
            _log_request_complete(response.status_code, stream=False)
        return response

    @app.errorhandler(Exception)
    def _handle_exception(error):
        if isinstance(error, HTTPException):
            logger.warning(
                "HTTP error request_id=%s method=%s path=%s status=%s message=%s",
                getattr(g, "request_id", None),
                request.method,
                request.path,
                error.code,
                error.description,
            )
            return _error(error.description, status=error.code, error_type="http_error")
        logger.exception(
            "Unhandled error request_id=%s method=%s path=%s",
            getattr(g, "request_id", None),
            request.method,
            request.path,
        )
        return _error("Internal server error.", status=500, error_type="server_error")
