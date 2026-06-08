import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

const port = 3334;
const child = spawn(process.execPath, ["./src/server.mjs"], {
  env: { ...process.env, MCP_TRANSPORT: "http", PORT: String(port) },
  stdio: ["ignore", "ignore", "inherit"]
});

await new Promise((resolve) => setTimeout(resolve, 400));

const events = [];
let endpoint;

const sseReq = http.request(
  {
    hostname: "127.0.0.1",
    port,
    path: "/sse",
    method: "GET",
    headers: { accept: "text/event-stream" }
  },
  (res) => {
    res.setEncoding("utf8");
    let event = "message";
    let data = "";
    res.on("data", (chunk) => {
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        if (line.startsWith("data: ")) data += line.slice(6);
        if (line === "" && data) {
          events.push({ event, data });
          if (event === "endpoint") endpoint = data;
          event = "message";
          data = "";
        }
      }
    });
  }
);
sseReq.end();

while (!endpoint) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function postRpc(id, method, params) {
  const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  const req = http.request({
    hostname: "127.0.0.1",
    port,
    path: endpoint,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload)
    }
  });
  req.end(payload);
  await once(req, "response");
}

await postRpc(1, "initialize", { protocolVersion: "2024-11-05" });
await postRpc(2, "tools/list", {});

while (events.filter((item) => item.event === "message").length < 2) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

console.log(JSON.stringify(events, null, 2));
child.kill();
