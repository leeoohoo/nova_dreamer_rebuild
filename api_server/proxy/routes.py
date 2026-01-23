from .routes_chat import register_chat_routes
from .routes_health import register_health_routes
from .routes_hooks import register_request_hooks
from .routes_models import register_model_routes


def register_routes(app):
    register_request_hooks(app)
    register_health_routes(app)
    register_model_routes(app)
    register_chat_routes(app)
