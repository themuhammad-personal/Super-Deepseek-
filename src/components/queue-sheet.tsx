import { BottomSheet } from "./ui/bottom-sheet";
import { useAppStore } from "@/lib/app-store";
import { t } from "@/lib/i18n";
import { sendChat } from "@/lib/send-chat";

export function QueueSheet() {
  const open = useAppStore((s) => s.ui.queueOpen);
  const queue = useAppStore((s) => s.queue);
  const locale = useAppStore((s) => s.settings.locale);
  const online = useAppStore((s) => s.ui.online);

  async function flushOne(id: string) {
    const item = useAppStore.getState().queue.find((q) => q.id === id);
    if (!item) return;
    useAppStore.getState().dequeue(id);
    await sendChat({
      chatId: item.chatId,
      content: item.content,
      attachments: item.attachments,
      mode: item.mode,
      webSearch: item.webSearch,
    });
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => useAppStore.getState().setQueueOpen(v)}
      title={t(locale, "queueTitle")}
    >
      {queue.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">{t(locale, "queueEmpty")}</p>
      ) : (
        <div className="space-y-2 py-2">
          {queue.map((q) => (
            <div
              key={q.id}
              className="rounded-[var(--radius-md)] bg-elevated p-3 shadow-[var(--shadow-border)]"
            >
              <p className="line-clamp-2 text-sm">{q.content}</p>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={!online}
                  className="h-9 rounded-[var(--radius-sm)] px-3 text-xs font-medium text-accent disabled:opacity-40"
                  onClick={() => void flushOne(q.id)}
                >
                  {t(locale, "retryNow")}
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="h-10 w-full rounded-[var(--radius-sm)] text-sm text-danger"
            onClick={() => useAppStore.getState().clearQueue()}
          >
            {t(locale, "clearQueue")}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}

export async function flushQueue(): Promise<void> {
  const items = [...useAppStore.getState().queue];
  for (const item of items) {
    useAppStore.getState().dequeue(item.id);
    await sendChat({
      chatId: item.chatId,
      content: item.content,
      attachments: item.attachments,
      mode: item.mode,
      webSearch: item.webSearch,
    });
  }
}
