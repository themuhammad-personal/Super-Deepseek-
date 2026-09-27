import assert from "node:assert/strict";
import test from "node:test";
import { groupChats, titleFromPrompt } from "./group-chats.ts";
import type { Chat } from "./types.ts";

function chat(partial: Partial<Chat> & Pick<Chat, "id" | "title">): Chat {
  return {
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    messages: [],
    ...partial,
  };
}

test("titleFromPrompt trims and ellipsizes", () => {
  assert.equal(titleFromPrompt("  hello   world  "), "hello world");
  assert.equal(titleFromPrompt(""), "New chat");
  const long = "a".repeat(50);
  assert.equal(titleFromPrompt(long).endsWith("…"), true);
  assert.equal(titleFromPrompt(long).length, 43);
});

test("groupChats buckets pinned separately and sorts recency", () => {
  const now = Date.now();
  const items = groupChats([
    chat({ id: "1", title: "old", updatedAt: now - 20 * 86400000 }),
    chat({ id: "2", title: "today", updatedAt: now }),
    chat({ id: "3", title: "pin", pinned: true, updatedAt: now - 86400000 }),
  ]);
  assert.equal(items[0]?.key, "pinned");
  assert.equal(items[0]?.items[0]?.id, "3");
  assert.ok(items.some((g) => g.key === "today"));
  assert.ok(items.some((g) => g.key === "older"));
});
