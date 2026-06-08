import https from "node:https";

const API_URL = process.env.CAFETERIA_API_URL || "";

export const CAMPUS = process.env.CAFETERIA_CAMPUS || "";
export const CAFETERIA_SEQ = process.env.CAFETERIA_SEQ || "";
export const MEAL_TYPES = {
  LN: "점심",
  DN: "저녁"
};

export function normalizeDate(ymd) {
  if (!ymd) {
    const now = new Date();
    const seoul = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now);
    return seoul.replaceAll("-", "");
  }

  const compact = String(ymd).replaceAll("-", "");
  if (!/^\d{8}$/.test(compact)) {
    throw new Error("ymd는 YYYYMMDD 또는 YYYY-MM-DD 형식이어야 합니다.");
  }

  return compact;
}

export function normalizeMealType(mealType) {
  const value = String(mealType || "LN").toUpperCase();
  if (!Object.hasOwn(MEAL_TYPES, value)) {
    throw new Error("mealType은 LN(점심) 또는 DN(저녁)만 사용할 수 있습니다.");
  }
  return value;
}

export async function fetchCafeteriaMenu({ ymd, mealType = "LN" } = {}) {
  if (!API_URL || !CAMPUS || !CAFETERIA_SEQ) {
    throw new Error("CAFETERIA_API_URL, CAFETERIA_CAMPUS, CAFETERIA_SEQ 환경변수가 필요합니다.");
  }

  const normalizedYmd = normalizeDate(ymd);
  const normalizedMealType = normalizeMealType(mealType);
  const apiOrigin = process.env.CAFETERIA_ORIGIN || new URL(API_URL).origin;
  const query = new URLSearchParams({
    campus: CAMPUS,
    cafeteriaSeq: CAFETERIA_SEQ,
    mealType: normalizedMealType,
    ymd: normalizedYmd
  });
  const requestUrl = new URL(API_URL);
  for (const [key, value] of query) {
    requestUrl.searchParams.set(key, value);
  }

  let text;
  try {
    text = await requestText(requestUrl, {
      headers: {
        accept: "application/json,text/plain,*/*",
        "content-length": "0",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        "x-requested-with": "XMLHttpRequest",
        origin: apiOrigin,
        referer: `${apiOrigin}/`
      }
    });
  } catch (error) {
    throw new Error(`식당 API 네트워크 호출 실패: ${formatError(error)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`식당 API 응답이 JSON이 아닙니다: ${text.slice(0, 300)}`);
  }

  const menus = Array.isArray(payload.menuList) ? payload.menuList.map(normalizeMenuItem) : [];
  return {
    campus: CAMPUS,
    cafeteriaSeq: CAFETERIA_SEQ,
    ymd: normalizedYmd,
    mealType: normalizedMealType,
    mealName: MEAL_TYPES[normalizedMealType],
    weather: payload.WEATHER || "",
    temperature: payload.TEMPERATURE || "",
    precipitation: payload.PRECIPITATION || "",
    menus
  };
}

function requestText(url, { headers }, redirectCount = 0) {
  const skipTlsVerify = process.env.CAFETERIA_SKIP_TLS_VERIFY === "true";

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers,
        family: 4,
        timeout: 30000,
        rejectUnauthorized: !skipTlsVerify
      },
      (res) => {
        const chunks = [];
        res.setEncoding("utf8");
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = chunks.join("");
          if ([301, 302, 303, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
            if (redirectCount >= 5) {
              reject(new Error("식당 API redirect 횟수가 너무 많습니다."));
              return;
            }
            const nextUrl = new URL(res.headers.location, url);
            requestText(nextUrl, { headers }, redirectCount + 1).then(resolve, reject);
            return;
          }
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`식당 API 호출 실패: HTTP ${res.statusCode || "unknown"} ${text.slice(0, 300)}`));
            return;
          }
          resolve(text);
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("식당 API 연결 시간이 초과되었습니다."));
    });
    req.on("error", reject);
    req.end();
  });
}

function formatError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `; cause=${error.cause.message}` : "";
  const code = error.cause && typeof error.cause === "object" && "code" in error.cause ? `; code=${error.cause.code}` : "";
  return `${error.message}${cause}${code}`;
}

export function normalizeMenuItem(item) {
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
    congestion: String(item.CONGESTION || "").trim()
  };
}

export function formatMenu(result) {
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
      menu.congestion ? `혼잡도 ${menu.congestion}` : ""
    ].filter(Boolean);
    lines.push("");
    lines.push(`- ${menu.courseName}: ${menu.menuName}${meta.length ? ` (${meta.join(", ")})` : ""}`);
    if (menu.sides.length > 0) lines.push(`  구성: ${menu.sides.join(", ")}`);
    if (menu.origin) lines.push(`  원산지: ${menu.origin}`);
    if (menu.guide) lines.push(`  안내: ${menu.guide}`);
  }

  return lines.join("\n");
}
