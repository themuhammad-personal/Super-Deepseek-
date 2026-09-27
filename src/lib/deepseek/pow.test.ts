/**
 * Contract test for the DeepSeekHashV1 PoW solver.
 *
 * This exercises the *shipping* `solvePow()` from ./pow against challenges we
 * plant ourselves, so a regression in the WASM calling convention (argument
 * order, retptr layout, answer extraction) fails here instead of surfacing in
 * production as an opaque "PoW solver found no solution".
 *
 * The WASM contract was derived by disassembling sha3_wasm_bg.wasm:
 *
 *   wasm_solve(retptr, chPtr, chLen, pfxPtr, pfxLen, budget:f64) -> void
 *     - `challenge` is HEX-DECODED inside the module (odd length or a non-hex
 *       char makes it bail instantly with "not found").
 *     - `budget` is an ITERATION LIMIT, not a leading-zero-bit difficulty.
 *       The loop runs counter = 0..budget-1 and compares
 *       SHA3-256(prefix ++ decimal(counter)) against the first 32 bytes of the
 *       decoded challenge.
 *     - On return: Int32[retptr+0] === 1 means SOLVED and the answer is the
 *       Float64 at retptr+8. (0 means no solution and the f64 reads 0.0.)
 *
 * Run: npx tsx --test src/lib/deepseek/pow.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { solvePow, type PowChallenge } from "./pow.ts";

type HashExports = {
  memory: WebAssembly.Memory;
  wasm_deepseek_hash_v1: (retptr: number, ptr: number, len: number) => void;
  __wbindgen_export_0: (len: number, align: number) => number;
  __wbindgen_add_to_stack_pointer: (n: number) => number;
};

let wasm: HashExports | null = null;

async function loadHashWasm(): Promise<HashExports> {
  if (wasm) return wasm;
  const bytes = await readFile(join(process.cwd(), "public/ds/sha3_wasm_bg.wasm"));
  const inst = await WebAssembly.instantiate(await WebAssembly.compile(bytes), {});
  wasm = inst.exports as unknown as HashExports;
  return wasm;
}

/** Mirrors what the DeepSeek server does to mint a challenge. */
async function serverHash(input: string): Promise<string> {
  const e = await loadHashWasm();
  const retptr = e.__wbindgen_add_to_stack_pointer(-16);
  try {
    const encoded = new TextEncoder().encode(input);
    const ptr = e.__wbindgen_export_0(encoded.length, 1);
    new Uint8Array(e.memory.buffer).set(encoded, ptr);
    e.wasm_deepseek_hash_v1(retptr, ptr, encoded.length);
    const dv = new DataView(e.memory.buffer);
    const strPtr = dv.getUint32(retptr, true);
    const strLen = dv.getUint32(retptr + 4, true);
    return new TextDecoder().decode(new Uint8Array(e.memory.buffer, strPtr, strLen));
  } finally {
    e.__wbindgen_add_to_stack_pointer(16);
  }
}

function makeChallenge(salt: string, expireAt: number, plantedAnswer: number): Promise<PowChallenge> {
  const prefix = `${salt}_${expireAt}_`;
  return serverHash(`${prefix}${plantedAnswer}`).then((target) => ({
    algorithm: "DeepSeekHashV1",
    challenge: target,
    salt,
    signature: "sig",
    difficulty: plantedAnswer + 1,
    expire_at: expireAt,
    target_path: "/api/v0/chat/completion",
  }));
}

function decode(powResponse: string) {
  return JSON.parse(Buffer.from(powResponse, "base64").toString("utf8")) as {
    algorithm: string;
    challenge: string;
    salt: string;
    answer: number;
    signature: string;
    target_path: string;
  };
}

test("solvePow recovers a planted answer", async () => {
  const challenge = await makeChallenge("SALT_A", 1790131999, 7);
  const payload = decode(await solvePow(challenge));
  assert.equal(payload.answer, 7, "solver must find the counter the server planted");
  assert.equal(payload.algorithm, "DeepSeekHashV1");
  assert.equal(payload.salt, "SALT_A");
  assert.equal(payload.signature, "sig");
  assert.equal(payload.target_path, "/api/v0/chat/completion");
  assert.equal(payload.challenge, challenge.challenge);
});

test("solvePow recovers a larger planted answer", async () => {
  const challenge = await makeChallenge("SALT_B", 1790131999, 4321);
  // Budget must exceed the answer or the search legitimately fails.
  challenge.difficulty = 100_000;
  const payload = decode(await solvePow(challenge));
  assert.equal(payload.answer, 4321);
});

test("solvePow reports failure instead of returning a bogus answer", async () => {
  // Budget of 3 cannot reach an answer of 50_000 — the solver must throw rather
  // than hand back answer=0, which the server would reject as an invalid PoW.
  const challenge = await makeChallenge("SALT_C", 1790131999, 50_000);
  challenge.difficulty = 3;
  await assert.rejects(() => solvePow(challenge), /no solution/i);
});

test("solvePow rejects a non-hex challenge (e.g. base64) with a clear error", async () => {
  // The module hex-decodes `challenge`; a base64 value makes it bail instantly.
  // Guarding this here documents the trap rather than leaving it silent.
  const challenge: PowChallenge = {
    algorithm: "DeepSeekHashV1",
    challenge: "Zm9vYmFy", // base64, not hex
    salt: "SALT_D",
    signature: "sig",
    difficulty: 1000,
    expire_at: 1790131999,
    target_path: "/api/v0/chat/completion",
  };
  await assert.rejects(() => solvePow(challenge), /no solution|hex/i);
});
