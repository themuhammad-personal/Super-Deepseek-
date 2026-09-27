import assert from "node:assert/strict";
import test from "node:test";
import { createSseAcc, parseSseChunk } from "./parse-sse.ts";

test("[DONE], comments and event lines", () => {
  const acc = createSseAcc();
  assert.deepEqual(parseSseChunk("data: [DONE]", acc), { done: true });
  assert.equal(parseSseChunk("event: title", acc), null);
  assert.equal(parseSseChunk(": keepalive", acc), null);
  assert.equal(parseSseChunk("", acc), null);
});

test("error object surfaces message", () => {
  const acc = createSseAcc();
  const err = parseSseChunk(JSON.stringify({ type: "error", content: "boom" }), acc);
  assert.equal(err?.error, "boom");
});

test("bare envelope error inside stream", () => {
  const acc = createSseAcc();
  const err = parseSseChunk(JSON.stringify({ code: 40003, msg: "INVALID_TOKEN" }), acc);
  assert.equal(err?.error, "INVALID_TOKEN");
});

test("old format: path events then pathless continuations", () => {
  const acc = createSseAcc();
  parseSseChunk(JSON.stringify({ p: "response/thinking_content", v: "hmm" }), acc);
  parseSseChunk(JSON.stringify({ o: "APPEND", v: " yes" }), acc); // no p -> thinking
  parseSseChunk(JSON.stringify({ v: "..." }), acc); // no p, no o -> thinking
  parseSseChunk(JSON.stringify({ p: "response/content", o: "APPEND", v: "Hi" }), acc);
  parseSseChunk(JSON.stringify({ v: "!" }), acc); // no p -> content now
  parseSseChunk(JSON.stringify({ p: "response/status", v: "FINISHED" }), acc); // skip
  assert.equal(acc.thinking, "hmm yes...");
  assert.equal(acc.text, "Hi!");
});

test("new format: fragments with type switches", () => {
  const acc = createSseAcc();
  parseSseChunk(
    JSON.stringify({ v: { response: { fragments: [{ type: "THINK", content: "t1" }] } } }),
    acc,
  );
  parseSseChunk(
    JSON.stringify({ p: "response/fragments/-1/content", o: "APPEND", v: "t2" }),
    acc,
  );
  parseSseChunk(JSON.stringify({ v: "t3" }), acc); // pathless -> THINK
  parseSseChunk(
    JSON.stringify({
      p: "response/fragments",
      o: "APPEND",
      v: [{ id: 1, type: "RESPONSE", content: "c1" }],
    }),
    acc,
  );
  parseSseChunk(JSON.stringify({ p: "response/fragments/-1/content", v: "c2" }), acc);
  parseSseChunk(JSON.stringify({ v: "c3" }), acc); // pathless -> RESPONSE
  assert.equal(acc.thinking, "t1t2t3");
  assert.equal(acc.text, "c1c2c3");
});

test("toast error inside v object", () => {
  const acc = createSseAcc();
  const err = parseSseChunk(
    JSON.stringify({ v: { type: "error", content: "rate limited", finish_reason: "error" } }),
    acc,
  );
  assert.equal(err?.error, "rate limited");
});

test("captures the streamed assistant message id for the parent chain", () => {
  const acc = createSseAcc();
  parseSseChunk(JSON.stringify({ message_id: "msg_123", o: "APPEND", v: "hi" }), acc);
  assert.equal(acc.messageId, "msg_123");
  parseSseChunk(JSON.stringify({ response_message_id: "msg_456" }), acc);
  assert.equal(acc.messageId, "msg_456");
});

test("OpenAI-like fallback deltas", () => {
  const acc = createSseAcc();
  parseSseChunk(
    JSON.stringify({ choices: [{ delta: { reasoning_content: "hmm", content: "hi" } }] }),
    acc,
  );
  assert.equal(acc.thinking, "hmm");
  assert.equal(acc.text, "hi");
});
