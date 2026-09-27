import { useEffect, useState } from "react";
import { BottomSheet } from "./ui/bottom-sheet";
import { Toggle } from "./ui/controls";
import { useAppStore } from "@/lib/app-store";
import { pingServer } from "@/lib/mcp-presets";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { uid } from "@/lib/utils";

export function McpDashboard() {
  const open = useAppStore((s) => s.ui.mcpOpen);
  const mcp = useAppStore((s) => s.mcp);
  const locale = useAppStore((s) => s.settings.locale);
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    async function tick() {
      const list = useAppStore.getState().mcp;
      await Promise.all(
        list.map(async (s) => {
          useAppStore.getState().setMcpStatus(s.id, { status: "checking" });
          const r = await pingServer(s);
          if (!alive) return;
          useAppStore.getState().setMcpStatus(s.id, {
            status: r.status,
            latency: r.latency,
            lastPingMs: Date.now(),
          });
        }),
      );
    }
    void tick();
    const id = window.setInterval(() => void tick(), 14000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [open]);

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => useAppStore.getState().setMcpOpen(v)}
      title={t(locale, "mcpTitle")}
    >
      <p className="pb-3 text-sm text-muted">{t(locale, "mcpHint")}</p>
      <div className="space-y-2 pb-4">
        {mcp.map((s) => (
          <div
            key={s.id}
            className="flex items-start gap-3 rounded-[var(--radius-md)] bg-elevated p-3 shadow-[var(--shadow-border)]"
          >
            <span
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                s.status === "online" && "bg-ok",
                s.status === "offline" && "bg-danger",
                s.status === "checking" && "bg-warn",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">{s.name}</p>
                <span className="text-[11px] uppercase tracking-wide text-faint">
                  {t(locale, s.status)}
                  {s.latency != null && s.status === "online" ? ` · ${s.latency}ms` : ""}
                </span>
              </div>
              <p className="text-xs text-muted">{s.description}</p>
              {!s.builtin ? (
                <button
                  type="button"
                  className="mt-1 text-xs text-danger"
                  onClick={() => useAppStore.getState().deleteMcp(s.id)}
                >
                  {t(locale, "delete")}
                </button>
              ) : null}
            </div>
            <Toggle on={s.enabled} onChange={() => useAppStore.getState().toggleMcp(s.id)} />
          </div>
        ))}
      </div>
      <div className="rounded-[var(--radius-md)] bg-elevated p-3 shadow-[var(--shadow-border)]">
        <p className="mb-2 text-sm font-medium">{t(locale, "mcpAdd")}</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t(locale, "mcpName")}
          className="mb-2 h-10 w-full rounded-[var(--radius-sm)] bg-bg px-3 text-sm outline-none"
        />
        <input
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder={t(locale, "mcpUrl")}
          className="mb-2 h-10 w-full rounded-[var(--radius-sm)] bg-bg px-3 text-sm outline-none"
        />
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={t(locale, "mcpKey")}
          className="mb-2 h-10 w-full rounded-[var(--radius-sm)] bg-bg px-3 text-sm outline-none"
        />
        <button
          type="button"
          className="h-11 w-full rounded-[var(--radius-sm)] bg-accent text-sm font-medium text-accent-fg"
          onClick={() => {
            if (!name.trim() || !endpoint.trim()) return;
            useAppStore.getState().upsertMcp({
              id: uid("mcp"),
              name: name.trim(),
              description: endpoint.trim(),
              endpoint: endpoint.trim(),
              enabled: true,
              builtin: false,
              status: "checking",
              apiKey: apiKey.trim() || undefined,
            });
            setName("");
            setEndpoint("");
            setApiKey("");
          }}
        >
          {t(locale, "add")}
        </button>
      </div>
    </BottomSheet>
  );
}
