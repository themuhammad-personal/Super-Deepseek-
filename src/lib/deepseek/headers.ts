export const DS_ORIGIN = "https://chat.deepseek.com";
export const DS_API = `${DS_ORIGIN}/api/v0`;

export const DESKTOP_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

export function dsHeaders(token?: string, extra?: Record<string, string>): HeadersInit {
  const h: Record<string, string> = {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    Origin: DS_ORIGIN,
    Referer: `${DS_ORIGIN}/`,
    "User-Agent": DESKTOP_UA,
    "X-Client-Platform": "web",
    // DeepSeek keys behaviour off this; 1.0.0 got clients rejected or handed
    // empty envelopes. 2.4.2 matches the current official web build.
    "X-Client-Version": "2.4.2",
    "X-Client-Locale": "en_US",
    ...extra,
  };
  if (token) h.Authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  return h;
}

export function newDeviceId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=+$/, "");
}
