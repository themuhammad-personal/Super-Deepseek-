/**
 * DeepSeek sign-in.
 *
 * This module used to also carry the whole chat path (dsCreateSessionDirect,
 * dsCompleteStreamDirect and a JS<->Kotlin PoW round trip). That code is gone:
 * chat now goes through src/lib/deepseek/api.ts over plain same-origin fetch.
 * See docs/DIAGNOSIS-AND-FIX-PLAN.md for why.
 *
 * Login is the one operation that still needs a real browser, because
 * `POST /api/v0/users/login` sits behind an AWS WAF JS challenge while the chat
 * endpoints do not. So the credentials are handed to the native side, which runs
 * them inside the DeepSeek WebView, and we then verify the token we get back.
 */
import { dsHeaders, newDeviceId } from "./headers.ts";
import { DS_API_BASE } from "./api.ts";

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

declare global {
  interface Window {
    AndroidBridge?: {
      dsLoginNative?: (payloadJson: string, callbackId: string) => void;
      onOfficialToken?: (token: string) => void;
      getOfficialToken?: () => string | null;
      switchToOfficialLogin?: () => void;
      mcpRequest?: (endpoint: string, headersJson: string, body: string, callbackName: string) => void;
    };
    _dsLoginCallbacks?: Record<string, { resolve: (v: any) => void; reject: (e: string) => void }>;
  }
}

function hasBridge(): boolean {
  return typeof window !== "undefined" && typeof window.AndroidBridge?.dsLoginNative === "function";
}

function storeAccount(token: string, email = "", mobile = "") {
  try {
    const w = window as unknown as { useAppStore?: { getState: () => any } };
    w.useAppStore?.getState()?.setAccount?.({ token, email, mobile });
  } catch {
    /* store not ready yet */
  }
}

/**
 * Confirm a token is actually usable before the app depends on it.
 *
 * DeepSeek authenticates purely off the `Authorization: Bearer` header — the
 * `ds_web_token` cookie is ignored — so one `/users/current` call is a complete
 * check. Without it the polling path could hand the app a token scraped while
 * the login WebView was still sitting on the WAF challenge page, and every later
 * call would fail with no explanation.
 */
export async function assertTokenWorks(token: string): Promise<void> {
  const { currentUser } = await import("./api.ts");
  try {
    await currentUser(token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`DeepSeek rejected this session (${msg}). Please sign in again.`);
  }
}

// Pick up a token the official WebView published.
if (typeof window !== "undefined") {
  window.addEventListener(
    "sds:official-token",
    ((e: CustomEvent) => {
      const token = (e.detail as { token?: string })?.token;
      if (!token || token.length <= 20) return;
      console.log("[login] token received via event, verifying…");
      assertTokenWorks(token)
        .then(() => storeAccount(token))
        .catch((err) => console.warn("[login] event token rejected:", err));
    }) as EventListener,
  );

  // The native side may already hold a token from a previous session.
  const checkSavedToken = () => {
    try {
      const token = window.AndroidBridge?.getOfficialToken?.();
      if (!token || token.length <= 20) return;
      const account = (window as unknown as { useAppStore?: { getState: () => any } }).useAppStore
        ?.getState()?.account;
      if (account?.token && account.token.length > 20) return;
      assertTokenWorks(token)
        .then(() => {
          console.log("[login] saved token verified");
          storeAccount(token);
        })
        .catch((err) => console.warn("[login] saved token rejected:", err));
    } catch {
      /* bridge not ready */
    }
  };
  if (document.readyState === "complete") checkSavedToken();
  else window.addEventListener("load", () => setTimeout(checkSavedToken, 1000));
}

function dsLoginViaNative(
  body: DsLoginBody,
): Promise<{ token: string; email: string; mobile: string }> {
  return new Promise((resolve, reject) => {
    const bridge = window.AndroidBridge;
    if (!bridge?.dsLoginNative) {
      reject("Native bridge not available");
      return;
    }
    const callbackId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    window._dsLoginCallbacks = window._dsLoginCallbacks || {};

    const timer = setTimeout(() => {
      delete window._dsLoginCallbacks![callbackId];
      reject("WAF challenge solving... Please wait 5 sec and retry");
    }, 20_000);

    window._dsLoginCallbacks[callbackId] = {
      resolve: (data: { token: string; email: string; mobile: string }) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject: (err: string) => {
        clearTimeout(timer);
        reject(err);
      },
    };

    try {
      bridge.dsLoginNative(
        JSON.stringify({
          email: body.email?.trim() || undefined,
          mobile: body.mobile?.trim() || undefined,
          area_code: body.area_code || "+880",
          password: body.password,
        }),
        callbackId,
      );
    } catch (e) {
      clearTimeout(timer);
      delete window._dsLoginCallbacks![callbackId];
      reject((e as Error).message || "Native call failed");
    }
  });
}

async function dsLoginViaNativeWithRetry(
  body: DsLoginBody,
  retries = 2,
): Promise<{ token: string; email: string; mobile: string }> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      if (i > 0) await new Promise((r) => setTimeout(r, 3000 + i * 1000));
      return await dsLoginViaNative(body);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("WAF") && i < retries) continue;
      throw e;
    }
  }
  throw lastErr;
}

export async function dsLoginDirect(body: DsLoginBody) {
  if (hasBridge()) {
    const nativeRes = await dsLoginViaNativeWithRetry(body, 2);
    if (nativeRes.token) {
      console.log("[login] native bridge returned a token, verifying…");
      await assertTokenWorks(nativeRes.token);
      return nativeRes;
    }
    throw new Error("Native login returned no token.");
  }

  // Browser / dev-server path.
  const res = await fetch(`${DS_API_BASE}/users/login`, {
    method: "POST",
    headers: dsHeaders(),
    body: JSON.stringify({
      email: body.email?.trim() || null,
      mobile: body.mobile?.trim() || null,
      password: body.password,
      area_code: body.area_code || "+880",
      device_id: newDeviceId(),
      os: "web",
    }),
  });
  const text = await res.text();
  let json: Envelope<{ user?: { token?: string; email?: string; mobile?: string }; token?: string }>;
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(
      res.status === 202
        ? "DeepSeek's anti-bot challenge blocked the sign-in. Please try again."
        : `Sign-in failed (HTTP ${res.status}).`,
    );
  }
  if (!res.ok) throw new Error(`Login failed (${res.status})`);
  const data = unwrap(json, "Email or password is incorrect.");
  const user = (data.user ?? data) as { token?: string; email?: string; mobile?: string };
  const token = user.token || data.token;
  if (!token) throw new Error("DeepSeek did not return a session.");
  await assertTokenWorks(token);
  return {
    token,
    email: user.email || body.email || "",
    mobile: user.mobile || body.mobile || "",
  };
}
