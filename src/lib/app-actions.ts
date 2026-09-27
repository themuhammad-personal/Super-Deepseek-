import { useAppStore } from "@/lib/app-store";
import { sendChat } from "@/lib/send-chat";
import { ragList } from "@/lib/rag";

/**
 * Shared actions used by more than one component. They live here (not in a
 * component module) so react-refresh can hot-swap the sheets themselves —
 * a module that exports both components and functions disables fast refresh.
 */

/** Send every queued message in order, dropping each from the queue first. */
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

/** Refresh the RAG document count shown in settings. */
export function refreshRagCount() {
  void ragList().then((d) => useAppStore.getState().setRagCount(d.length));
}
