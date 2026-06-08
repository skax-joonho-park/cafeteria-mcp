const cafeteriaUrl = Deno.env.get("CAFETERIA_API_URL") || "";
const cafeteriaCampus = Deno.env.get("CAFETERIA_CAMPUS") || "";
const cafeteriaSeq = Deno.env.get("CAFETERIA_SEQ") || "";
const cafeteriaOrigin = Deno.env.get("CAFETERIA_ORIGIN") || (cafeteriaUrl ? new URL(cafeteriaUrl).origin : "");

const targets = {
  google: "https://www.google.com/",
  cafeteria: cafeteriaUrl,
} as const;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const target = url.searchParams.get("target") || "google";

  if (target !== "google" && target !== "cafeteria") {
    return json({ ok: false, error: "Use target=google or target=cafeteria." }, 400);
  }

  if (target === "cafeteria" && (!cafeteriaUrl || !cafeteriaCampus || !cafeteriaSeq)) {
    return json({
      ok: false,
      target,
      error: "CAFETERIA_API_URL, CAFETERIA_CAMPUS, CAFETERIA_SEQ secrets are required.",
    }, 400);
  }

  const requestUrl = new URL(targets[target]);
  if (target === "cafeteria") {
    requestUrl.searchParams.set("campus", cafeteriaCampus);
    requestUrl.searchParams.set("cafeteriaSeq", cafeteriaSeq);
    requestUrl.searchParams.set("mealType", url.searchParams.get("mealType") || "LN");
    requestUrl.searchParams.set("ymd", url.searchParams.get("ymd") || todaySeoul());
  }

  const network = await diagnoseNetwork(requestUrl);
  const fetchResult = await probeFetch(target, requestUrl);

  return json({
    ok: fetchResult.ok,
    target,
    url: redactUrl(requestUrl),
    network,
    fetch: fetchResult,
  });
});

async function probeFetch(target: "google" | "cafeteria", url: URL) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("fetch timeout"), 15000);

  try {
    const response = await fetch(url, {
      method: target === "cafeteria" ? "POST" : "HEAD",
      headers: target === "cafeteria"
        ? {
            "accept": "application/json,text/plain,*/*",
            "content-length": "0",
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
            "x-requested-with": "XMLHttpRequest",
            "origin": cafeteriaOrigin,
            "referer": `${cafeteriaOrigin}/`,
          }
        : {
            "user-agent": "Mozilla/5.0",
          },
      signal: controller.signal,
    });
    const body = target === "cafeteria" ? await response.text() : "";
    return {
      ok: response.ok,
      elapsedMs: Date.now() - started,
      status: response.status,
      bodyPreview: body.slice(0, 500),
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - started,
      ...formatError(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function diagnoseNetwork(url: URL) {
  const hostname = url.hostname;
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const result: Record<string, unknown> = { hostname, port };

  const dnsStarted = Date.now();
  try {
    if (typeof Deno.resolveDns !== "function") {
      throw new Error("Deno.resolveDns is unavailable in this runtime.");
    }
    result.dns = {
      ok: true,
      elapsedMs: Date.now() - dnsStarted,
      addresses: await Deno.resolveDns(hostname, "A"),
    };
  } catch (error) {
    result.dns = { ok: false, elapsedMs: Date.now() - dnsStarted, ...formatError(error) };
  }

  const tcpStarted = Date.now();
  try {
    if (typeof Deno.connect !== "function") {
      throw new Error("Deno.connect is unavailable in this runtime.");
    }
    const conn = await withTimeout(Deno.connect({ hostname, port }), 10000, "TCP connect timeout");
    conn.close();
    result.tcp = { ok: true, elapsedMs: Date.now() - tcpStarted };
  } catch (error) {
    result.tcp = { ok: false, elapsedMs: Date.now() - tcpStarted, ...formatError(error) };
  }

  return result;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function todaySeoul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()).replaceAll("-", "");
}

function redactUrl(url: URL) {
  return `${url.origin}${url.pathname}`;
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return {
      error: error.message,
      name: error.name,
      cause: error.cause instanceof Error ? error.cause.message : undefined,
    };
  }
  return { error: String(error) };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
