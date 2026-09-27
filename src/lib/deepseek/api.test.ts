/**
 * Tests for the DeepSeek API client (src/lib/deepseek/api.ts).
 *
 * The PoW challenge used here is a real, solvable one minted with the same WASM
 * the app ships, so `completeStream` exercises the actual solve -> header ->
 * request path rather than a stub.
 *
 * Run: npx tsx --test src/lib/deepseek/api.test.ts
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertSolvable, completeStream, createSession, DsApiError } from "./api.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Route = { status?: number; body?: unknown; raw?: string; contentType?: string };

const WASM_PATH = join(process.cwd(), "public/ds/sha3_wasm_bg.wasm");

/**
 * `pow-browser.ts` loads the solver WASM over HTTP, so the stub has to serve it
 * too — otherwise `solvePow` fails on the wasm request instead of solving.
 */
async function wasmResponse() {
  const bytes = await readFile(WASM_PATH);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "application/wasm" },
  });
}

function stubFetch(routes: Record<string, Route>) {
  const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("sha3_wasm_bg.wasm")) return wasmResponse();
    calls.push({
      url,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const match = Object.keys(routes).find((k) => url.endsWith(k));
    if (!match) throw new Error(`unexpected fetch: ${url}`);
    const r = routes[match];
    // `raw` lets a route answer like the real SSE endpoint does; `body` answers
    // like DeepSeek's JSON error envelope (HTTP 200 + application/json).
    if (r.raw !== undefined) {
      return new Response(r.raw, {
        status: r.status ?? 200,
        headers: { "content-type": r.contentType ?? "text/event-stream" },
      });
    }
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

/** Mint a solvable challenge with the shipped WASM. */
async function mintChallenge(plantedAnswer: number, budget = 100_000) {
  const bytes = await readFile(join(process.cwd(), "public/ds/sha3_wasm_bg.wasm"));
  const inst = await WebAssembly.instantiate(await WebAssembly.compile(bytes), {});
  const e = inst.exports as {
    memory: WebAssembly.Memory;
    wasm_deepseek_hash_v1: (r: number, p: number, l: number) => void;
    __wbindgen_export_0: (l: number, a: number) => number;
    __wbindgen_add_to_stack_pointer: (n: number) => number;
  };
  const rp = e.__wbindgen_add_to_stack_pointer(-16);
  const salt = "TESTSALT";
  const expire_at = 1790131999;
  const input = `${salt}_${expire_at}_${plantedAnswer}`;
  const enc = new TextEncoder().encode(input);
  const ptr = e.__wbindgen_export_0(enc.length, 1);
  new Uint8Array(e.memory.buffer).set(enc, ptr);
  e.wasm_deepseek_hash_v1(rp, ptr, enc.length);
  const dv = new DataView(e.memory.buffer);
  const target = new TextDecoder().decode(
    new Uint8Array(e.memory.buffer, dv.getUint32(rp, true), dv.getUint32(rp + 4, true)),
  );
  e.__wbindgen_add_to_stack_pointer(16);
  return {
    algorithm: "DeepSeekHashV1",
    challenge: target,
    salt,
    signature: "sig",
    difficulty: budget,
    expire_at,
    target_path: "/api/v0/chat/completion",
  };
}

test("assertSolvable accepts a hex challenge and rejects base64", () => {
  assert.doesNotThrow(() =>
    assertSolvable({
      algorithm: "DeepSeekHashV1",
      challenge: "ab".repeat(32),
      salt: "s",
      signature: "g",
      difficulty: 1000,
      expire_at: 1,
      target_path: "/api/v0/chat/completion",
    }),
  );
  assert.throws(
    () =>
      assertSolvable({
        algorithm: "DeepSeekHashV1",
        challenge: "Zm9vYmFy", // base64
        salt: "s",
        signature: "g",
        difficulty: 1000,
        expire_at: 1,
        target_path: "/api/v0/chat/completion",
      }),
    /not hex/,
  );
  assert.throws(
    () =>
      assertSolvable({
        algorithm: "DeepSeekHashV1",
        challenge: "ab".repeat(32),
        salt: "s",
        signature: "g",
        difficulty: 0,
        expire_at: 1,
        target_path: "/api/v0/chat/completion",
      }),
    /budget/,
  );
});

test("createSession unwraps the biz_data envelope and sends Bearer", async () => {
  const calls = stubFetch({
    "/chat_session/create": { body: { code: 0, data: { biz_code: 0, biz_data: { chat_session: { id: "sess-1" } } } } },
  });
  const id = await createSession("tok123");
  assert.equal(id, "sess-1");
  assert.equal(calls[0].url, "/api/v0/chat_session/create");
  assert.equal(calls[0].headers.Authorization, "Bearer tok123");
});

test("createSession surfaces the server's business error", async () => {
  stubFetch({
    "/chat_session/create": { body: { code: 0, data: { biz_code: 40003, biz_msg: "token expired" } } },
  });
  await assert.rejects(() => createSession("bad"), /token expired/);
});

test("completeStream solves the PoW and sends it as X-Ds-Pow-Response", async () => {
  const challenge = await mintChallenge(7);
  const calls = stubFetch({
    "/chat/create_pow_challenge": { body: { code: 0, data: { biz_code: 0, biz_data: { challenge } } } },
    "/chat/completion": { raw: "data: {}\n\n" },
  });

  const res = await completeStream({
    token: "tok123",
    sessionId: "sess-1",
    prompt: "hello",
    thinking: false,
    search: false,
  });

  assert.equal(res.status, 200);
  const completion = calls.find((c) => c.url.endsWith("/chat/completion"))!;
  assert.ok(completion.headers["X-Ds-Pow-Response"], "PoW header must be sent");

  // The header is base64 JSON; decode it and check the answer we planted.
  const pow = JSON.parse(
    Buffer.from(completion.headers["X-Ds-Pow-Response"], "base64").toString("utf8"),
  ) as { answer: number; target_path: string; challenge: string };
  assert.equal(pow.answer, 7, "the solved PoW must contain the correct answer");
  assert.equal(pow.target_path, "/api/v0/chat/completion");
  assert.equal(pow.challenge, challenge.challenge);

  const body = JSON.parse(completion.body!) as Record<string, unknown>;
  assert.equal(body.chat_session_id, "sess-1");
  assert.equal(body.prompt, "hello");
  assert.equal(body.parent_message_id, null);
});

test("completeStream re-solves once when DeepSeek rejects the proof-of-work", async () => {
  const challenge = await mintChallenge(11);
  let completionCalls = 0;
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown, _init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("sha3_wasm_bg.wasm")) return wasmResponse();
    if (url.endsWith("/chat/create_pow_challenge")) {
      return new Response(
        JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { challenge } } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    completionCalls++;
    if (completionCalls === 1) {
      return new Response(JSON.stringify({ code: 40301, msg: "pow invalid" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("data: {}\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as unknown as typeof fetch;

  const res = await completeStream({
    token: "tok",
    sessionId: "s",
    prompt: "hi",
    thinking: false,
    search: false,
  });
  assert.equal(res.status, 200);
  assert.equal(completionCalls, 2, "should retry exactly once");
  assert.equal(calls.filter((u) => u.endsWith("/chat/create_pow_challenge")).length, 2);
});

test("completeStream turns an expired session into a re-login prompt", async () => {
  stubFetch({
    "/chat/create_pow_challenge": { body: { code: 0, data: { biz_code: 0, biz_data: { challenge: await mintChallenge(3) } } } },
    "/chat/completion": { body: { code: 40003, msg: "INVALID_TOKEN" } },
  });
  await assert.rejects(
    () =>
      completeStream({ token: "t", sessionId: "s", prompt: "hi", thinking: false, search: false }),
    (err: unknown) => err instanceof DsApiError && /sign in again/i.test(err.message),
  );
});
