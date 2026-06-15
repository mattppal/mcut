import { createElement, type CSSProperties } from "react";
import { ImageResponse } from "takumi-js/response";

type Env = {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  LOOPS_API_KEY?: string;
  LOOPS_WAITLIST_ID?: string;
};

const LOOPS_UPDATE_CONTACT_URL = "https://app.loops.so/api/v1/contacts/update";
const MAX_BODY_BYTES = 2048;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const OG_IMAGE_SIZE = { width: 1200, height: 630 };
const DEFAULT_OG_TITLE = "Open source video editing for agents";
const DEFAULT_OG_DESCRIPTION =
  "TypeScript packages for timelines, media, captions, CLI workflows, and MCP tools.";

const requestCounts = new Map<string, { count: number; resetAt: number }>();

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...init?.headers,
    },
  });
}

function isValidEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function clampText(value: string | null, fallback: string, maxLength: number) {
  const text = value?.trim() || fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

const h = createElement;

function titleParts(title: string) {
  const match = /\bagents\b/i.exec(title);
  if (!match) return [title];

  return [
    title.slice(0, match.index),
    h(
      "span",
      { key: "agents", style: styles.highlight },
      title.slice(match.index, match.index + match[0].length),
    ),
    title.slice(match.index + match[0].length),
  ];
}

const styles = {
  frame: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    padding: "72px 88px 62px",
    border: "1px solid #e5e5e5",
    backgroundColor: "#ffffff",
    color: "#171717",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  top: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: 25,
    color: "#737373",
  },
  brand: {
    fontFamily: '"Instrument Serif", Georgia, serif',
    fontSize: 58,
    fontStyle: "italic",
    fontWeight: 700,
    lineHeight: 0.9,
    color: "#171717",
  },
  tag: {
    fontFamily: '"Geist Mono", "SFMono-Regular", Consolas, monospace',
    fontSize: 22,
    color: "#525252",
  },
  main: {
    display: "flex",
    flexDirection: "column",
    gap: 34,
  },
  title: {
    margin: 0,
    maxWidth: 900,
    fontSize: 84,
    fontWeight: 650,
    lineHeight: 1.08,
    letterSpacing: 0,
  },
  highlight: {
    display: "inline-block",
    padding: "0 12px 4px",
    borderRadius: 7,
    backgroundColor: "rgba(221, 214, 254, 0.9)",
    color: "#171717",
    fontFamily: '"Instrument Serif", Georgia, serif',
    fontStyle: "italic",
    fontWeight: 700,
  },
  description: {
    margin: 0,
    maxWidth: 680,
    color: "#525252",
    fontSize: 31,
    lineHeight: 1.35,
  },
  bottom: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingTop: 30,
    borderTop: "1px solid #e5e5e5",
  },
  license: {
    color: "#737373",
    fontSize: 22,
  },
  packages: {
    fontFamily: '"Geist Mono", "SFMono-Regular", Consolas, monospace',
    fontSize: 26,
    color: "#171717",
  },
} satisfies Record<string, CSSProperties>;

function ogImage(title: string, description: string) {
  return h(
    "div",
    { style: styles.frame },
    h(
      "div",
      { style: styles.top },
      h("div", { style: styles.brand }, "mcut"),
      h("div", { style: styles.tag }, "video SDK + editor"),
    ),
    h(
      "div",
      { style: styles.main },
      h("h1", { style: styles.title }, ...titleParts(title)),
      h("p", { style: styles.description }, description),
    ),
    h(
      "div",
      { style: styles.bottom },
      h("div", { style: styles.license }, "Apache-2.0"),
      h("div", { style: styles.packages }, "@mcut/*"),
    ),
  );
}

function handleOgImage(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed.", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const url = new URL(request.url);
  const title = clampText(url.searchParams.get("title"), DEFAULT_OG_TITLE, 92);
  const description = clampText(
    url.searchParams.get("description"),
    DEFAULT_OG_DESCRIPTION,
    150,
  );

  return new ImageResponse(ogImage(title, description), {
    ...OG_IMAGE_SIZE,
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "image/png",
    },
  });
}

function tooManyRequests(request: Request, email: string) {
  const ip =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown";
  const key = `${ip}:${email}`;
  const now = Date.now();
  const entry = requestCounts.get(key);

  if (!entry || entry.resetAt <= now) {
    requestCounts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

async function readJson(request: Request) {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { error: json({ message: "Expected a JSON request." }, { status: 415 }) };
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return { error: json({ message: "Request body is too large." }, { status: 413 }) };
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return { error: json({ message: "Request body is too large." }, { status: 413 }) };
  }

  try {
    return { body: JSON.parse(body) as unknown };
  } catch {
    return { error: json({ message: "Invalid JSON request." }, { status: 400 }) };
  }
}

async function handleWaitlist(request: Request, env: Env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (request.method !== "POST") {
    return json({ message: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
  }

  if (!env.LOOPS_API_KEY || !env.LOOPS_WAITLIST_ID) {
    console.error("Missing Loops environment bindings.");
    return json({ message: "Waitlist signup is not configured." }, { status: 503 });
  }

  const parsed = await readJson(request);
  if (parsed.error) return parsed.error;

  const payload = parsed.body;
  if (!payload || typeof payload !== "object") {
    return json({ message: "Invalid waitlist request." }, { status: 400 });
  }

  const { email: rawEmail, website } = payload as { email?: unknown; website?: unknown };
  if (typeof website === "string" && website.trim()) {
    return json({ success: true });
  }

  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!isValidEmail(email)) {
    return json({ message: "Enter a valid email address." }, { status: 400 });
  }

  if (tooManyRequests(request, email)) {
    return json({ message: "Too many attempts. Try again in a minute." }, { status: 429 });
  }

  const loopsResponse = await fetch(LOOPS_UPDATE_CONTACT_URL, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.LOOPS_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      email,
      source: "mcut-web-waitlist",
      mailingLists: {
        [env.LOOPS_WAITLIST_ID]: true,
      },
    }),
  });

  if (!loopsResponse.ok) {
    const details = await loopsResponse.text().catch(() => "");
    console.error("Loops waitlist signup failed.", {
      status: loopsResponse.status,
      details: details.slice(0, 500),
    });
    return json({ message: "Unable to join right now." }, { status: 502 });
  }

  return json({ success: true });
}

const worker = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/waitlist") {
      return handleWaitlist(request, env);
    }

    if (url.pathname === "/og") {
      return handleOgImage(request);
    }

    return env.ASSETS.fetch(request);
  },
};

export default worker;
