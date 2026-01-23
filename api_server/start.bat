@echo off
if "%PROXY_HOST%"=="" set PROXY_HOST=0.0.0.0
if "%PROXY_PORT%"=="" set PROXY_PORT=8000

python app.py
