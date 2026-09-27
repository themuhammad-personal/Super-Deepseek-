/**
 * DeepSeekHashV1 PoW solver using the official sha3 WASM module.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type PowChallenge = {
  algorithm: string;
  challenge: string;
  salt: string;
  signature: string;
  difficulty: number;
  expire_at: number;
  expire_after?: number;
  target_path: string;
};

type WasmExports = {
  memory: WebAssembly.Memory;
  wasm_solve: (
    retptr: number,
    chPtr: number,
    chLen: number,
    pfxPtr: number,
    pfxLen: number,
    difficulty: number,
  ) => void;
  __wbindgen_export_0: (len: number, align: number) => number;
  __wbindgen_add_to_stack_pointer: (n: number) => number;
};

let wasmBytes: Buffer | null = null;
let compiled: WebAssembly.Module | null = null;

async function loadWasm(): Promise<WebAssembly.Module> {
  if (compiled) return compiled;
  if (!wasmBytes) {
    const candidates = [
      join(process.cwd(), "public/ds/sha3_wasm_bg.wasm"),
      join(process.cwd(), "android/app/src/main/assets/ds/sha3_wasm_bg.wasm"),
    ];
    let lastErr: unknown;
    for (const p of candidates) {
      try {
        wasmBytes = await readFile(p);
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!wasmBytes) throw lastErr ?? new Error("PoW WASM missing");
  }
  compiled = await WebAssembly.compile(new Uint8Array(wasmBytes));
  return compiled;
}

function writeString(exports: WasmExports, str: string): { ptr: number; length: number } {
  const encoded = new TextEncoder().encode(str);
  const ptr = exports.__wbindgen_export_0(encoded.length, 1);
  new Uint8Array(exports.memory.buffer).set(encoded, ptr);
  return { ptr, length: encoded.length };
}

export async function solvePow(challenge: PowChallenge): Promise<string> {
  const mod = await loadWasm();
  const instance = await WebAssembly.instantiate(mod, {});
  const exports = instance.exports as unknown as WasmExports;
  const prefix = `${challenge.salt}_${challenge.expire_at}_`;
  const retptr = exports.__wbindgen_add_to_stack_pointer(-16);
  try {
    const ch = writeString(exports, challenge.challenge);
    const pfx = writeString(exports, prefix);
    exports.wasm_solve(retptr, ch.ptr, ch.length, pfx.ptr, pfx.length, challenge.difficulty);
    const status = new Int32Array(exports.memory.buffer)[retptr / 4];
    if (!status) throw new Error("PoW solver found no solution");
    const value = new Float64Array(exports.memory.buffer)[(retptr + 8) / 8];
    const answer = Math.floor(value);
    const payload = {
      algorithm: challenge.algorithm || "DeepSeekHashV1",
      challenge: challenge.challenge,
      salt: challenge.salt,
      answer,
      signature: challenge.signature,
      target_path: challenge.target_path || "/api/v0/chat/completion",
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64");
  } finally {
    exports.__wbindgen_add_to_stack_pointer(16);
  }
}
