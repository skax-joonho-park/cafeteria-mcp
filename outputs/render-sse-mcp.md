# Render SSE MCP 배포 메모

## Public endpoint

Render 배포 후 MCP SSE URL은 다음 형태입니다.

```text
https://<render-service-name>.onrender.com/sse
```

이 서버는 구형 MCP SSE transport 호환을 위해 다음 엔드포인트를 제공합니다.

- `GET /sse`: SSE 연결을 열고 `endpoint` 이벤트로 메시지 POST 경로를 반환
- `POST /messages?sessionId=...`: JSON-RPC MCP 요청 수신
- `GET /health`: Render health check
- `POST /mcp`: 단순 HTTP JSON-RPC 테스트용

## Render Blueprint

프로젝트 루트의 `render.yaml`을 Render Blueprint로 배포하면 됩니다.

```yaml
services:
  - type: web
    name: cafeteria-mcp
    runtime: node
    plan: free
    buildCommand: npm install
    startCommand: npm start
    healthCheckPath: /health
    envVars:
      - key: NODE_VERSION
        value: 24.12.0
      - key: MCP_TRANSPORT
        value: http
      - key: CAFETERIA_API_URL
        sync: false
      - key: CAFETERIA_CAMPUS
        sync: false
      - key: CAFETERIA_SEQ
        sync: false
      - key: CAFETERIA_SKIP_TLS_VERIFY
        sync: false
```

## 등록 예시

MCP SSE를 받는 클라이언트에는 아래 URL을 등록합니다.

```json
{
  "mcpServers": {
    "cafeteria": {
      "url": "https://<render-service-name>.onrender.com/sse"
    }
  }
}
```
