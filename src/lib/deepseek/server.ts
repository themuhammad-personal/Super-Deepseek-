import { DS_API, dsHeaders, newDeviceId } from "./headers";
import { solvePow, type PowChallenge } from "./pow";

export type DsLoginBody = {
  email?: string;
  mobile?: string;
  password: string;
  area_code?: string;
};

type Envelope<T> = {
  code?: number;
  msg?: string;
  data?: {
    biz_code?: number;
    biz_msg?: string;
    biz_data?: T;
  };
};

function unwrap<T>(json: Envelope<T>, fallback: string): T {
  const biz = json.data;
  if (biz && biz.biz_code && biz.biz_code !== 0) {
    throw new Error(biz.biz_msg || fallback);
  }
  if (!biz?.biz_data) throw new Error(json.msg || fallback);
  return biz.biz_data;
}

export async function dsLogin(body: DsLoginBody) {
  const payload = {
    email: body.email?.trim() || null,
    mobile: body.mobile?.trim() || null,
    password: body.password,
    area_code: body.area_code || "+880",
    device_id: newDeviceId(),
    os: "web",
  };
  const res = await fetch(`${DS_API}/users/login`, {
    method: "POST",
    headers: dsHeaders(),
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as Envelope<{
    user?: { token?: string; email?: string; mobile?: string; id?: string };
    token?: string;
  }>;
  if (!res.ok) throw new Error(`Login failed (${res.status})`);
  const data = unwrap(json, "Email or password is incorrect.");
  const user = (data.user ?? data) as {
    token?: string;
    email?: string;
    mobile?: string;
  };
  const token = user.token || data.token;
  if (!token) throw new Error("DeepSeek did not return a session.");
  return {
    token,
    email: user.email || body.email || "",
    mobile: user.mobile || body.mobile || "",
  };
}

export async function dsCurrentUser(token: string) {
  const res = await fetch(`${DS_API}/users/current`, { headers: dsHeaders(token) });
  const json = (await res.json()) as Envelope<{ user?: { email?: string; mobile?: string } }>;
  if (!res.ok) throw new Error("Session expired. Please sign in again.");
  return unwrap(json, "Session expired.");
}

export async function dsCreateSession(token: string): Promise<string> {
  const res = await fetch(`${DS_API}/chat_session/create`, {
    method: "POST",
    headers: dsHeaders(token),
    body: "{}",
  });
  const json = (await res.json()) as Envelope<{ chat_session?: { id?: string } }>;
  const data = unwrap(json, "Could not start a chat.");
  const id = data.chat_session?.id;
  if (!id) throw new Error("Could not start a chat.");
  return id;
}

async function dsPowHeader(token: string, targetPath = "/api/v0/chat/completion"): Promise<string> {
  const res = await fetch(`${DS_API}/chat/create_pow_challenge`, {
    method: "POST",
    headers: dsHeaders(token),
    body: JSON.stringify({ target_path: targetPath }),
  });
  const json = (await res.json()) as Envelope<{ challenge?: PowChallenge }>;
  const data = unwrap(json, "PoW challenge failed.");
  if (!data.challenge) throw new Error("PoW challenge missing.");
  return solvePow(data.challenge);
}

export async function dsCompleteStream(opts: {
  token: string;
  sessionId: string;
  prompt: string;
  thinking: boolean;
  search: boolean;
  parentMessageId?: string | null;
  signal?: AbortSignal;
}): Promise<Response> {
  const pow = await dsPowHeader(opts.token);
  const upstream = await fetch(`${DS_API}/chat/completion`, {
    method: "POST",
    headers: dsHeaders(opts.token, { "X-Ds-Pow-Response": pow }),
    body: JSON.stringify({
      chat_session_id: opts.sessionId,
      parent_message_id: opts.parentMessageId ?? null,
      prompt: opts.prompt,
      ref_file_ids: [],
      thinking_enabled: opts.thinking,
      search_enabled: opts.search,
      preempt: false,
    }),
    signal: opts.signal,
  });
  return upstream;
}

export function bearerFromRequest(request: Request): string {
  const h = request.headers.get("authorization") || "";
  return h.replace(/^Bearer\s+/i, "").trim();
}
