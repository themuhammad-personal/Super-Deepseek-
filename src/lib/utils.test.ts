import assert from "node:assert/strict";
import test from "node:test";
import { clamp, uid } from "./utils.ts";

test("uid is unique and prefixed", () => {
  const a = uid("chat");
  const b = uid("chat");
  assert.notEqual(a, b);
  assert.match(a, /^chat_/);
});

test("clamp bounds a number", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-2, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});
