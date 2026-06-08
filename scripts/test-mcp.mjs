import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

const child = spawn(process.execPath, ["./src/server.mjs"], {
  stdio: ["pipe", "pipe", "inherit"]
});

const lines = createInterface({ input: child.stdout });
let id = 0;

async function request(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params })}\n`);
  const [line] = await once(lines, "line");
  return JSON.parse(line);
}

try {
  console.log(JSON.stringify(await request("initialize", { protocolVersion: "2024-11-05" }), null, 2));
  console.log(JSON.stringify(await request("tools/list", {}), null, 2));
  console.log(
    JSON.stringify(
      await request("tools/call", {
        name: "get_cafeteria_menu",
        arguments: {
          ymd: process.argv[2] || "20260608",
          mealType: process.argv[3] || "LN"
        }
      }),
      null,
      2
    )
  );
} finally {
  child.kill();
}
