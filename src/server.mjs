#!/usr/bin/env node
import http from "node:http";
import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";
import { fetchCafeteriaMenu, formatMenu } from "./cafeteria.mjs";

const SERVER_INFO = {
  name: "cafeteria-mcp",
  version: "0.1.0"
};

const TOOL = {
  name: "get_cafeteria_menu",
  description: "환경변수로 설정된 식당 API에서 메뉴를 조회합니다.",
  inputSchema: {
    type: "object",
    properties: {
      ymd: {
        type: "string",
        description: "조회일자. YYYYMMDD 또는 YYYY-MM-DD. 생략하면 Asia/Seoul 기준 오늘입니다."
      },
      mealType: {
        type: "string",
        enum: ["LN", "DN"],
        description: "LN은 점심, DN은 저녁입니다."
      }
    },
    required: []
  }
};

async function handleJsonRpc(message) {
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: SERVER_INFO
      }
    };
  }

  if (message.method === "notifications/initialized") {
    return null;
  }

  if (message.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [TOOL]
      }
    };
  }

  if (message.method === "tools/call") {
    const { name, arguments: args = {} } = message.params || {};
    if (name !== TOOL.name) {
      return jsonRpcError(message.id, -32602, `Unknown tool: ${name}`);
    }

    try {
      const result = await fetchCafeteriaMenu(args);
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: formatMenu(result)
            },
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        }
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error)
            }
          ]
        }
      };
    }
  }

  return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message }
  };
}

async function startStdio() {
  stdin.setEncoding("utf8");
  let buffer = "";

  for await (const chunk of stdin) {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      const response = await handleJsonRpc(JSON.parse(line));
      if (response) stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
}

const sseSessions = new Map();

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function startHttp() {
  const port = Number(process.env.PORT || 3333);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(`${SERVER_INFO.name} is running. Use GET /sse for MCP over SSE.\n`);
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, server: SERVER_INFO }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/diag/fetch") {
      const target = url.searchParams.get("target");
      const targets = {
        google: "https://www.google.com/",
        cafeteria: process.env.CAFETERIA_API_URL || ""
      };
      const targetUrl = target && Object.hasOwn(targets, target) ? targets[target] : "";

      if (!targetUrl) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Use target=google or target=cafeteria." }));
        return;
      }

      const started = Date.now();
      try {
        const response = await fetch(targetUrl, {
          method: "HEAD",
          signal: AbortSignal.timeout(10000),
          headers: {
            "user-agent": "Mozilla/5.0"
          }
        });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            ok: true,
            target,
            status: response.status,
            elapsedMs: Date.now() - started
          })
        );
      } catch (error) {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            ok: false,
            target,
            elapsedMs: Date.now() - started,
            error: error instanceof Error ? error.message : String(error),
            cause: error?.cause instanceof Error ? error.cause.message : undefined,
            code: error?.cause && typeof error.cause === "object" && "code" in error.cause ? error.cause.code : undefined
          })
        );
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/sse") {
      const sessionId = randomUUID();
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      res.write(": connected\n\n");

      const messagesPath = `/messages?sessionId=${encodeURIComponent(sessionId)}`;
      sseSessions.set(sessionId, res);
      sendSse(res, "endpoint", messagesPath);

      const keepAlive = setInterval(() => {
        if (!res.destroyed) res.write(": keep-alive\n\n");
      }, 25000);

      req.on("close", () => {
        clearInterval(keepAlive);
        sseSessions.delete(sessionId);
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/messages") {
      const sessionId = url.searchParams.get("sessionId");
      const sseRes = sessionId ? sseSessions.get(sessionId) : null;

      if (!sseRes) {
        res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(jsonRpcError(null, -32000, "Unknown or expired SSE session.")));
        return;
      }

      try {
        const message = await parseBody(req);
        const response = await handleJsonRpc(message);
        if (response) sendSse(sseRes, "message", response);
        res.writeHead(202, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ accepted: true }));
      } catch (error) {
        const response = jsonRpcError(null, -32700, error instanceof Error ? error.message : String(error));
        sendSse(sseRes, "message", response);
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(response));
      }
      return;
    }

    if (req.method !== "POST" || url.pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Use GET /sse for MCP over SSE or POST /mcp for JSON-RPC." }));
      return;
    }

    try {
      const message = await parseBody(req);
      const response = await handleJsonRpc(message);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(response ?? { ok: true }));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(jsonRpcError(null, -32700, error instanceof Error ? error.message : String(error))));
    }
  });

  server.listen(port, "0.0.0.0", () => {
    const host = process.env.RENDER_EXTERNAL_HOSTNAME || `127.0.0.1:${port}`;
    console.error(`${SERVER_INFO.name} listening on http://${host}/mcp`);
  });
}

if (process.env.MCP_TRANSPORT === "http") {
  startHttp();
} else if (process.env.RENDER || process.env.PORT) {
  startHttp();
} else {
  startStdio();
}
