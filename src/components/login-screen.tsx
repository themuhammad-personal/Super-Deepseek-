import { useEffect, useState } from "react";
import { LogoMark } from "./logo-mark";
import { useAppStore } from "@/lib/app-store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/types";
import { dsLoginDirect } from "@/lib/deepseek/client-direct";

type Tab = "email" | "phone";

export function LoginScreen() {
  const locale = useAppStore((s) => s.settings.locale);
  const busy = useAppStore((s) => s.ui.loginBusy);
  const error = useAppStore((s) => s.ui.loginError);
  const [tab, setTab] = useState<Tab>("email");
  const [email, setEmail] = useState("thealaminpersonal@gmail.com");
  const [phone, setPhone] = useState("");
  const [area, setArea] = useState("+880");
  const [password, setPassword] = useState("");
  const [wafStatus, setWafStatus] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [isOfficialAvailable, setIsOfficialAvailable] = useState(false);

  useEffect(() => {
    const bridge = (window as any).AndroidBridge;
    if (bridge) {
      if (bridge.getOfficialToken) {
        const saved = bridge.getOfficialToken();
        if (saved && saved.length > 20) {
          setWafStatus("✅ Official token found! Signing in...");
          const store = useAppStore.getState();
          store.setAccount({ token: saved, email: "", mobile: "" });
          return;
        }
      }
      if (bridge.switchToOfficialLogin) {
        setIsOfficialAvailable(true);
        setWafStatus("🌐 Official DeepSeek login available - tap 'Official Login Page' for 100% official login");
        setTimeout(() => setWafStatus(""), 5000);
      } else if (bridge.dsLoginNative) {
        setWafStatus("✅ Native bridge ready - hidden WebView solving WAF...");
        setTimeout(() => setWafStatus(""), 4000);
      }
    }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as any;
      const token = detail?.token;
      if (token && token.length > 20) {
        setWafStatus("🎉 Official login detected! Loading custom UI...");
        const store = useAppStore.getState();
        store.setAccount({ token, email: "", mobile: "" });
      }
    };
    window.addEventListener('sds:official-token', handler as any);
    return () => window.removeEventListener('sds:official-token', handler as any);
  }, []);

  function openOfficialLogin() {
    const bridge = (window as any).AndroidBridge;
    if (bridge?.switchToOfficialLogin) {
      setWafStatus("🌐 Opening official DeepSeek login page...");
      bridge.switchToOfficialLogin();
    } else {
      setWafStatus("Official WebView not available, using API login");
    }
  }

  async function doLogin(_attempt = 0): Promise<{ token: string; email: string; mobile: string }> {
    return dsLoginDirect(
      tab === "email"
        ? { email: email.trim(), password }
        : { mobile: phone.trim(), area_code: area, password }
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const store = useAppStore.getState();
    store.setLoginError("");
    store.setLoginBusy(true);
    
    try {
      let token: string | undefined
      let retEmail: string | undefined
      let retMobile: string | undefined

      // Try server API first (web)
      try {
        const res = await fetch("/api/ds/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            tab === "email"
              ? { email: email.trim(), password }
              : { mobile: phone.trim(), area_code: area, password },
          ),
        });
        const json = (await res.json()) as any;
        if (res.ok && json.token) {
          token = json.token
          retEmail = json.email
          retMobile = json.mobile
        } else {
          throw new Error(json.error || "Login failed")
        }
      } catch (err) {
        console.log("[Login] Server API failed, trying official DeepSeek:", err)
        
        // If official WebView available, suggest it
        if (isOfficialAvailable) {
          setWafStatus("💡 Server login failed - use Official Login Page for 100% official login (no WAF)")
          // Try direct anyway
        }
        
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (attempt === 0) {
              setWafStatus("🔐 Trying official DeepSeek login...")
            } else {
              setWafStatus(`⏳ Retry ${attempt + 1}/3...`)
              await new Promise(r => setTimeout(r, 2000))
            }
            
            const direct = await doLogin(attempt);
            token = direct.token
            retEmail = direct.email
            retMobile = direct.mobile
            setWafStatus("✅ Login success!")
            break
          } catch (directErr) {
            const msg = directErr instanceof Error ? directErr.message : "Sign in failed"
            console.error(`[Login] Attempt ${attempt + 1} failed:`, msg)
            
            if (msg.includes("WAF") && attempt < 2) {
              setWafStatus(`🛡️ WAF detected - Try Official Login Page (100% official, no WAF) - retry ${attempt + 1}/3`)
              setRetryCount(attempt + 1)
              continue
            }
            
            store.setLoginError(msg + (isOfficialAvailable ? " • Try Official Login Page" : ""))
            return
          }
        }
      }

      if (!token) {
        store.setLoginError(t(locale, "loginFailed"));
        return;
      }
      store.setAccount({
        token,
        email: retEmail || email.trim(),
        mobile: retMobile || phone.trim(),
      });
      setWafStatus("🎉 Signed in! Loading workspace...")
    } catch {
      store.setLoginError(t(locale, "loginFailed"));
    } finally {
      store.setLoginBusy(false);
      setTimeout(() => setWafStatus(""), 3000)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg px-6 text-fg">
      <div className="flex justify-end pt-[max(16px,env(safe-area-inset-top))]">
        <div className="flex rounded-[var(--radius-sm)] bg-elevated p-1 shadow-[var(--shadow-border)]">
          {(["en", "bn"] as Locale[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => useAppStore.getState().setLocale(id)}
              className={cn(
                "h-8 rounded-[6px] px-3 text-xs font-medium",
                locale === id ? "bg-surface text-fg" : "text-muted",
              )}
            >
              {id === "en" ? "EN" : "বাংলা"}
            </button>
          ))}
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark className="size-16" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">{t(locale, "appName")}</h1>
          <p className="mt-2 text-sm text-muted">{t(locale, "loginTagline")}</p>
        </div>

        <div className="mb-5 flex rounded-[var(--radius-sm)] bg-elevated p-1 shadow-[var(--shadow-border)]">
          {(["email", "phone"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "h-9 flex-1 rounded-[6px] text-sm font-medium",
                tab === id ? "bg-surface text-fg" : "text-muted",
              )}
            >
              {t(locale, id === "email" ? "email" : "phone")}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          {tab === "email" ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">{t(locale, "email")}</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                type="email"
                autoComplete="email"
                className="h-11 w-full rounded-[var(--radius-md)] bg-surface px-4 text-sm shadow-[var(--shadow-border)] outline-none placeholder:text-faint focus:ring-2 focus:ring-accent"
                required
              />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted">{t(locale, "areaCode")}</label>
                <input
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  className="h-11 w-full rounded-[var(--radius-md)] bg-surface px-4 text-sm shadow-[var(--shadow-border)] outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted">{t(locale, "phone")}</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="1XXXXXXXXX"
                  inputMode="numeric"
                  className="h-11 w-full rounded-[var(--radius-md)] bg-surface px-4 text-sm shadow-[var(--shadow-border)] outline-none placeholder:text-faint focus:ring-2 focus:ring-accent"
                  required
                />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted">{t(locale, "password")}</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              className="h-11 w-full rounded-[var(--radius-md)] bg-surface px-4 text-sm shadow-[var(--shadow-border)] outline-none focus:ring-2 focus:ring-accent"
              required
            />
          </div>

          {wafStatus ? (
            <p className="rounded-[var(--radius-sm)] bg-accent/10 px-3 py-2 text-xs text-accent animate-pulse">{wafStatus}</p>
          ) : null}

          {error ? (
            <div className="space-y-2">
              <p className="rounded-[var(--radius-sm)] bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
              {error.includes("WAF") || error.includes("Official") ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={openOfficialLogin}
                    className="w-full rounded-[var(--radius-sm)] bg-accent px-3 py-2.5 text-xs font-medium text-white"
                  >
                    🌐 Open Official DeepSeek Login Page (100% Official, No WAF)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWafStatus("🔄 Retrying after WAF wait...");
                      setTimeout(() => onSubmit(new Event('submit') as any), 1000)
                    }}
                    className="w-full rounded-[var(--radius-sm)] bg-elevated px-3 py-2 text-xs text-accent"
                  >
                    Retry API after 3 sec (attempt {retryCount + 1})
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {isOfficialAvailable ? (
            <button
              type="button"
              onClick={openOfficialLogin}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[#0a0a0a] px-4 text-sm font-medium text-white shadow-[var(--shadow-border)] border border-white/10"
            >
              <span>🌐</span> Official DeepSeek Login Page (Recommended)
            </button>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="flex h-11 w-full items-center justify-center rounded-[var(--radius-md)] bg-accent px-4 text-sm font-medium text-white shadow-[var(--shadow-border)] disabled:opacity-60"
          >
            {busy ? t(locale, "signingIn") : t(locale, "continueWithDeepSeek")}
          </button>

          <p className="pt-2 text-center text-[11px] leading-4 text-faint">
            {isOfficialAvailable 
              ? "🌐 Official login loads https://chat.deepseek.com directly • After login, custom OLED UI overlays • 100% official account"
              : `${t(locale, "loginFooter")} • Official login via hidden WebView (bypass WAF)`}
          </p>
        </form>
      </div>
    </div>
  );
}
