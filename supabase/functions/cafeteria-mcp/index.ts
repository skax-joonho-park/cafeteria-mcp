const serverInfo = {
  name: "cafeteria-mcp",
  version: "0.2.0",
};

const mealTypes: Record<string, string> = {
  LN: "점심",
  DN: "저녁",
};

const tool = {
  name: "get_cafeteria_menu",
  description: "환경변수로 설정된 식당 API에서 메뉴를 조회합니다.",
  inputSchema: {
    type: "object",
    properties: {
      ymd: {
        type: "string",
        description: "조회일자. YYYYMMDD 또는 YYYY-MM-DD. 생략하면 Asia/Seoul 기준 오늘입니다.",
      },
      mealType: {
        type: "string",
        enum: ["LN", "DN"],
        description: "LN은 점심, DN은 저녁입니다.",
      },
    },
    required: [],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const url = new URL(req.url);
  if (shouldForwardToSeoul(req, url)) {
    return forwardToSeoul(req, url);
  }

  if (req.method === "GET") {
    return json({
      ok: true,
      server: serverInfo,
      endpoint: "/cafeteria-mcp",
      transport: "http-json-rpc",
      regionForwarding: "ap-northeast-2",
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Use POST for MCP JSON-RPC messages." }, 405);
  }

  try {
    const message = await req.json();
    const response = await handleJsonRpc(message);
    return json(response ?? { ok: true });
  } catch (error) {
    return json(jsonRpcError(null, -32700, error instanceof Error ? error.message : String(error)), 400);
  }
});

function shouldForwardToSeoul(req: Request, url: URL) {
  if (url.searchParams.get("regionForwarded") === "1") return false;
  if (url.searchParams.get("forceFunctionRegion") === "ap-northeast-2") return false;
  if (req.headers.get("x-region") === "ap-northeast-2") return false;
  return true;
}

async function forwardToSeoul(req: Request, url: URL) {
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
  url.searchParams.set("forceFunctionRegion", "ap-northeast-2");
  url.searchParams.set("regionForwarded", "1");

  const headers = new Headers();
  headers.set("accept", "application/json");
  headers.set("content-type", req.headers.get("content-type") || "application/json");
  headers.set("x-region", "ap-northeast-2");

  const authorization = req.headers.get("authorization");
  const apikey = req.headers.get("apikey");
  if (authorization) headers.set("authorization", authorization);
  if (apikey) headers.set("apikey", apikey);

  const response = await fetch(url, {
    method: req.method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function handleJsonRpc(message: Record<string, unknown>) {
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: getProtocolVersion(message),
        capabilities: {
          tools: {},
        },
        serverInfo,
      },
    };
  }

  if (message.method === "notifications/initialized") return null;

  if (message.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [tool],
      },
    };
  }

  if (message.method === "tools/call") {
    const params = message.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    if (params?.name !== tool.name) {
      return jsonRpcError(message.id, -32602, `Unknown tool: ${params?.name}`);
    }

    try {
      const result = await fetchCafeteriaMenu(params.arguments || {});
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: formatMenu(result),
            },
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
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
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        },
      };
    }
  }

  return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
}

async function fetchCafeteriaMenu(args: Record<string, unknown>) {
  const apiUrl = Deno.env.get("CAFETERIA_API_URL") || "";
  const campus = Deno.env.get("CAFETERIA_CAMPUS") || "";
  const cafeteriaSeq = Deno.env.get("CAFETERIA_SEQ") || "";
  const origin = Deno.env.get("CAFETERIA_ORIGIN") || (apiUrl ? new URL(apiUrl).origin : "");

  if (!apiUrl || !campus || !cafeteriaSeq) {
    throw new Error("CAFETERIA_API_URL, CAFETERIA_CAMPUS, CAFETERIA_SEQ secrets are required.");
  }

  const ymd = normalizeDate(args.ymd);
  const mealType = normalizeMealType(args.mealType);
  const url = new URL(apiUrl);
  url.searchParams.set("campus", campus);
  url.searchParams.set("cafeteriaSeq", cafeteriaSeq);
  url.searchParams.set("mealType", mealType);
  url.searchParams.set("ymd", ymd);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("cafeteria API timeout"), 30000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "accept": "application/json,text/plain,*/*",
        "content-length": "0",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        "x-requested-with": "XMLHttpRequest",
        "origin": origin,
        "referer": `${origin}/`,
      },
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`식당 API 호출 실패: HTTP ${response.status} ${text.slice(0, 300)}`);
    }

    const payload = JSON.parse(text);
    const menus = Array.isArray(payload.menuList) ? payload.menuList.map(normalizeMenuItem) : [];

    return {
      campus,
      cafeteriaSeq,
      ymd,
      mealType,
      mealName: mealTypes[mealType],
      weather: payload.WEATHER || "",
      temperature: payload.TEMPERATURE || "",
      precipitation: payload.PRECIPITATION || "",
      menus,
    };
  } catch (error) {
    throw new Error(`식당 API 네트워크 호출 실패: ${formatError(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeDate(value: unknown) {
  if (!value) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()).replaceAll("-", "");
  }

  const compact = String(value).replaceAll("-", "");
  if (!/^\d{8}$/.test(compact)) {
    throw new Error("ymd는 YYYYMMDD 또는 YYYY-MM-DD 형식이어야 합니다.");
  }
  return compact;
}

function normalizeMealType(value: unknown) {
  const mealType = String(value || "LN").toUpperCase();
  if (!Object.hasOwn(mealTypes, mealType)) {
    throw new Error("mealType은 LN(점심) 또는 DN(저녁)만 사용할 수 있습니다.");
  }
  return mealType;
}

function normalizeMenuItem(item: Record<string, unknown>) {
  const sides = ["SIDE_1", "SIDE_2", "SIDE_3", "SIDE_4", "SIDE_5", "SIDE_6"]
    .map((key) => String(item[key] || "").trim())
    .filter(Boolean);

  return {
    courseName: String(item.COURSE_NAME || "").trim(),
    menuName: String(item.MENU_NAME || "").trim(),
    sides,
    kcal: String(item.KCAL || "").trim(),
    origin: String(item.MENU_ORIGIN || "").trim(),
    avgStar: String(item.AVG_STAR || "").trim(),
    satisfactionCount: String(item.SATI_CNT || "").trim(),
    soldOut: String(item.SOLDOUT_YN || "").trim() === "Y",
    guide: String(item.MENU_GUIDE || "").trim(),
    congestion: String(item.CONGESTION || "").trim(),
  };
}

function formatMenu(result: {
  ymd: string;
  mealName: string;
  temperature: string;
  precipitation: string;
  menus: ReturnType<typeof normalizeMenuItem>[];
}) {
  const date = `${result.ymd.slice(0, 4)}-${result.ymd.slice(4, 6)}-${result.ymd.slice(6, 8)}`;
  const lines = [`${date} ${result.mealName} 메뉴`];

  if (result.temperature || result.precipitation) {
    lines.push(`날씨: 기온 ${result.temperature || "-"}도, 강수 ${result.precipitation || "-"}%`);
  }

  if (result.menus.length === 0) {
    lines.push("등록된 메뉴가 없습니다.");
    return lines.join("\n");
  }

  for (const menu of result.menus) {
    const meta = [
      menu.kcal ? `${menu.kcal} kcal` : "",
      menu.soldOut ? "sold out" : "",
      menu.avgStar ? `평점 ${menu.avgStar}` : "",
      menu.congestion ? `혼잡도 ${menu.congestion}` : "",
    ].filter(Boolean);
    lines.push("");
    lines.push(`- ${menu.courseName}: ${menu.menuName}${meta.length ? ` (${meta.join(", ")})` : ""}`);
    if (menu.sides.length > 0) lines.push(`  구성: ${menu.sides.join(", ")}`);
    if (menu.origin) lines.push(`  원산지: ${menu.origin}`);
    if (menu.guide) lines.push(`  안내: ${menu.guide}`);
  }

  return lines.join("\n");
}

function getProtocolVersion(message: Record<string, unknown>) {
  const params = message.params as { protocolVersion?: string } | undefined;
  return params?.protocolVersion || "2024-11-05";
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `; cause=${error.cause.message}` : "";
    return `${error.message}${cause}`;
  }
  return String(error);
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-client-info,apikey",
  };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json; charset=utf-8",
    },
  });
}
