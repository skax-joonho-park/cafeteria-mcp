# Cafeteria MCP

Configurable MCP server for cafeteria menu lookup.

The server exposes a single MCP tool, `get_cafeteria_menu`, and supports stdio plus HTTP/SSE transports.

## Configuration

Set these environment variables in your runtime or hosting provider:

```text
CAFETERIA_API_URL=<form-post-api-url>
CAFETERIA_CAMPUS=<campus-code>
CAFETERIA_SEQ=<cafeteria-sequence>
CAFETERIA_ORIGIN=<optional-origin-header>
MCP_TRANSPORT=http
```

`CAFETERIA_ORIGIN` is optional. When omitted, the origin is derived from `CAFETERIA_API_URL`.

## Tool

`get_cafeteria_menu`

- `ymd`: lookup date, `YYYYMMDD` or `YYYY-MM-DD`. Defaults to today in Asia/Seoul.
- `mealType`: `LN` for lunch, `DN` for dinner.

## Local stdio

```bash
npm start
```

MCP client example:

```json
{
  "mcpServers": {
    "cafeteria": {
      "command": "node",
      "args": [
        "/absolute/path/to/src/server.mjs"
      ]
    }
  }
}
```

## HTTP/SSE

```bash
MCP_TRANSPORT=http PORT=3333 npm start
```

- Health check: `GET http://127.0.0.1:3333/health`
- MCP SSE: `GET http://127.0.0.1:3333/sse`
- MCP SSE message post: `POST http://127.0.0.1:3333/messages?sessionId=...`
- MCP JSON-RPC test endpoint: `POST http://127.0.0.1:3333/mcp`

Hosting environments that provide `PORT` automatically run the HTTP/SSE transport.

## Render

Deploy the repository with the included `render.yaml` Blueprint.

After deployment, set the required secret environment variables in Render. The public MCP SSE URL will be:

```text
https://<render-service-name>.onrender.com/sse
```

See [outputs/render-sse-mcp.md](outputs/render-sse-mcp.md) for a short registration note.

## Tests

```bash
npm run test:sse
npm run test:mcp
npm run test:api -- 20260608 LN
```

`test:api` requires the environment variables above.
