import os

from flask import Flask
from flask_cors import CORS

from proxy.config import OPENAI_BASE_URL
from proxy.logger import logger
from proxy.routes import register_routes

app = Flask(__name__)
app.url_map.strict_slashes = False
CORS(app)
register_routes(app)


if __name__ == "__main__":
    host = os.getenv("PROXY_HOST", "0.0.0.0")
    port = int(os.getenv("PROXY_PORT", "8000"))
    logger.info("Starting proxy on %s:%s (upstream=%s)", host, port, OPENAI_BASE_URL)
    app.run(host=host, port=port, threaded=True)
