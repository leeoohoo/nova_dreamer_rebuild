# Flask OpenAI Proxy

A small Flask service that forwards OpenAI-compatible requests to an upstream OpenAI API using the OpenAI Python SDK.

## Features
- OpenAI-compatible endpoints: `/v1/chat/completions`, `/v1/models`, `/v1/health`.
- Streaming responses (SSE) for chat completions.
- Optional tool execution on the proxy side.
- API key validation for incoming requests.
- Configurable upstream base URL and timeouts.
- CORS enabled for browser clients.

## Requirements
- Python 3.10+

## Setup (pip)
```bash
python -m venv .venv
. .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Setup (conda)
```bash
conda env create -f environment.yml
conda activate openai-proxy
```

## Configuration
Set environment variables as needed:
- `OPENAI_API_KEY` (required): upstream OpenAI API key.
- `OPENAI_BASE_URL` (optional): upstream base URL. Default `https://api.openai.com`. `/v1` is appended if missing.
- `OPENAI_TIMEOUT` (optional): request timeout in seconds. Default `120`.
- `OPENAI_MAX_RETRIES` (optional): retry count. Default `2`.
- `OPENAI_ORGANIZATION`, `OPENAI_PROJECT` (optional): upstream headers.
- `PROXY_REQUIRE_API_KEY` (optional): `true/false`, require auth for incoming requests.
- `PROXY_API_KEYS` (optional): comma-separated allowed proxy API keys.
- `PROXY_FORWARD_AUTH_HEADER` (optional): if `true`, use incoming Bearer token as upstream API key.
- `ALLOW_UNAUTHENTICATED_HEALTH` (optional): allow `/v1/health` without auth.
- `ENABLE_TOOL_EXECUTION` (optional): execute tools defined in `function_tools.py`.
- `OPENAI_PARAM_DEFAULTS` (optional): JSON object of default params.
- `OPENAI_PARAM_OVERRIDES` (optional): JSON object of forced params.
- `OPENAI_PARAM_DROP` (optional): comma-separated params to remove.

## Run
```bash
python app.py
```

Or use the scripts:
```bash
./start.sh
```

```bat
start.bat
```

## Endpoints
- `GET /v1/health` -> `{"status":"ok"}`
- `GET /v1/models` -> upstream model list
- `POST /v1/chat/completions` -> chat completion (streaming supported)

### Example request
```bash
curl -s http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PROXY_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role":"user","content":"Hello"}]
  }'
```

### Streaming example
```bash
curl -N http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PROXY_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role":"user","content":"Stream this"}],
    "stream": true
  }'
```

## Tool execution
Enable with `ENABLE_TOOL_EXECUTION=true`. The proxy will execute tool calls returned by the model using `function_tools.execute_tool` and then send a follow-up request with tool outputs.

## Test client
```bash
set OPENAI_API_KEY=sk-your-upstream-key
set PROXY_API_KEY=your-proxy-key
python test_client.py
```

Optional streaming test:
```bash
set STREAM_TEST=1
python test_client.py
```

## Notes
- If `PROXY_REQUIRE_API_KEY=true`, pass `Authorization: Bearer <proxy_key>` to the proxy.
- If `PROXY_FORWARD_AUTH_HEADER=true`, the proxy forwards the incoming Bearer token to the upstream API.
