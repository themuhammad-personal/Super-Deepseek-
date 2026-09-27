import { isToday, isYesterday, differenceInCalendarDays } from "date-fns";
import type { Chat } from "./types";

export type ChatGroupKey = "pinned" | "today" | "yesterday" | "week" | "older";

export function groupChats(chats: Chat[]): { key: ChatGroupKey; items: Chat[] }[] {
  const buckets: Record<ChatGroupKey, Chat[]> = {
    pinned: [],
    today: [],
    yesterday: [],
    week: [],
    older: [],
  };
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const c of sorted) {
    if (c.pinned) {
      buckets.pinned.push(c);
      continue;
    }
    const d = new Date(c.updatedAt);
    if (isToday(d)) buckets.today.push(c);
    else if (isYesterday(d)) buckets.yesterday.push(c);
    else if (differenceInCalendarDays(new Date(), d) <= 7) buckets.week.push(c);
    else buckets.older.push(c);
  }
  const order: ChatGroupKey[] = ["pinned", "today", "yesterday", "week", "older"];
  return order.filter((k) => buckets[k].length).map((key) => ({ key, items: buckets[key] }));
}

export function titleFromPrompt(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
}
