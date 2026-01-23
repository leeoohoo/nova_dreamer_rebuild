#!/usr/bin/env bash
set -e

REQUIRED_MAJOR=3
REQUIRED_MINOR=10

PYTHON_BIN=${PYTHON_BIN:-python3}

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python not found. Please install Python ${REQUIRED_MAJOR}.${REQUIRED_MINOR}+ and retry."
  exit 1
fi

PY_VER=$($PYTHON_BIN -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=${PY_VER%%.*}
PY_MINOR=${PY_VER#*.}
PY_MINOR=${PY_MINOR%%.*}

if [ "$PY_MAJOR" -lt "$REQUIRED_MAJOR" ] || { [ "$PY_MAJOR" -eq "$REQUIRED_MAJOR" ] && [ "$PY_MINOR" -lt "$REQUIRED_MINOR" ]; }; then
  echo "Python ${REQUIRED_MAJOR}.${REQUIRED_MINOR}+ is required. Detected ${PY_VER}."
  exit 1
fi

echo "Python version OK: ${PY_VER}"

echo "Creating virtual environment (.venv)"
$PYTHON_BIN -m venv .venv

# shellcheck disable=SC1091
source .venv/bin/activate

python -m pip install --upgrade pip
pip install flask flask-cors openai requests

cat <<'EOF'

Installation complete.

Next steps:
1) Activate the virtual environment:
   source .venv/bin/activate

2) Set required environment variables (example):
   export OPENAI_API_KEY="sk-your-upstream-key"
   export PROXY_REQUIRE_API_KEY=true
   export PROXY_API_KEYS="my-proxy-key"

3) Run the server:
   python app.py

EOF
