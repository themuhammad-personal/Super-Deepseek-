import assert from "node:assert/strict";
import test from "node:test";
import { buildWireHistory } from "./history.ts";
import type { Message } from "../types.ts";

function msg(role: "user" | "assistant", content: string, extra?: Partial<Message>): Message {
  return { id: `${role}-${content.slice(0, 4)}`, role, content, createdAt: 0, ...extra };
}

test("keeps only real visible turns, in order", () => {
  const h = buildWireHistory([
    msg("user", "first question"),
    msg("assistant", "first answer"),
    msg("user", ""),
    msg("assistant", "", { error: "boom" }),
    msg("user", "second question"),
  ]);
  assert.deepEqual(h, [
    { role: "user", content: "first question" },
    { role: "assistant", content: "first answer" },
    { role: "user", content: "second question" },
  ]);
});

test("bounds by message count from the newest side", () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    msg(i % 2 === 0 ? "user" : "assistant", `m${i}`),
  );
  const h = buildWireHistory(many, 6, 100000);
  assert.equal(h.length, 6);
  assert.equal(h[0].content, "m34");
  assert.equal(h[5].content, "m39");
});

test("bounds by character budget", () => {
  const h = buildWireHistory(
    [msg("user", "x".repeat(100)), msg("assistant", "y".repeat(100)), msg("user", "z".repeat(50))],
    10,
    160,
  );
  assert.deepEqual(h, [
    { role: "assistant", content: "y".repeat(100) },
    { role: "user", content: "z".repeat(50) },
  ]);
});
