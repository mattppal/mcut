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

    return env.ASSETS.fetch(request);
  },
};

export default worker;
