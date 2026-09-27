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

let wasmModule: WebAssembly.Module | null = null;

async function loadWasm(): Promise<WebAssembly.Module> {
  if (wasmModule) return wasmModule;
  const candidates = [
    '/ds/sha3_wasm_bg.wasm',
    './ds/sha3_wasm_bg.wasm',
    '/assets/../ds/sha3_wasm_bg.wasm',
    'https://appassets.androidplatform.net/ds/sha3_wasm_bg.wasm',
    './assets/../../ds/sha3_wasm_bg.wasm',
  ];
  
  let lastErr: unknown;
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const bytes = await res.arrayBuffer();
      wasmModule = await WebAssembly.compile(bytes);
      return wasmModule;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('PoW WASM missing');
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
    if (!status) throw new Error('PoW solver found no solution');
    const value = new Float64Array(exports.memory.buffer)[(retptr + 8) / 8];
    const answer = Math.floor(value);
    const payload = {
      algorithm: challenge.algorithm || 'DeepSeekHashV1',
      challenge: challenge.challenge,
      salt: challenge.salt,
      answer,
      signature: challenge.signature,
      target_path: challenge.target_path || '/api/v0/chat/completion',
    };
    return btoa(JSON.stringify(payload));
  } finally {
    exports.__wbindgen_add_to_stack_pointer(16);
  }
}
