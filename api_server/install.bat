@echo off
setlocal enabledelayedexpansion

set REQUIRED_MAJOR=3
set REQUIRED_MINOR=10

set PYTHON_BIN=%PYTHON_BIN%
if "%PYTHON_BIN%"=="" set PYTHON_BIN=python

%PYTHON_BIN% -c "import sys; print(sys.version_info.major)" >nul 2>&1
if errorlevel 1 (
  echo Python not found. Please install Python %REQUIRED_MAJOR%.%REQUIRED_MINOR%+ and retry.
  exit /b 1
)

for /f %%i in ('%PYTHON_BIN% -c "import sys; print(sys.version_info.major)"') do set PY_MAJOR=%%i
for /f %%i in ('%PYTHON_BIN% -c "import sys; print(sys.version_info.minor)"') do set PY_MINOR=%%i

if %PY_MAJOR% LSS %REQUIRED_MAJOR% (
  echo Python %REQUIRED_MAJOR%.%REQUIRED_MINOR%+ is required. Detected %PY_MAJOR%.%PY_MINOR%.
  exit /b 1
)
if %PY_MAJOR% EQU %REQUIRED_MAJOR% if %PY_MINOR% LSS %REQUIRED_MINOR% (
  echo Python %REQUIRED_MAJOR%.%REQUIRED_MINOR%+ is required. Detected %PY_MAJOR%.%PY_MINOR%.
  exit /b 1
)

echo Python version OK: %PY_MAJOR%.%PY_MINOR%

echo Creating virtual environment (.venv)
%PYTHON_BIN% -m venv .venv
call .venv\Scripts\activate

python -m pip install --upgrade pip
pip install flask flask-cors openai requests

echo.
echo Installation complete.
echo.
echo Next steps:
echo 1^) Activate the virtual environment:
echo    .venv\Scripts\activate
echo.
echo 2^) Set required environment variables ^(example^):
echo    set OPENAI_API_KEY=sk-your-upstream-key
echo    set PROXY_REQUIRE_API_KEY=true
echo    set PROXY_API_KEYS=my-proxy-key
echo.
echo 3^) Run the server:
echo    python app.py
echo.

endlocal
