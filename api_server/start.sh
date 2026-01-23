#!/usr/bin/env bash
set -e

: "${PROXY_HOST:=0.0.0.0}"
: "${PROXY_PORT:=8000}"

python app.py
