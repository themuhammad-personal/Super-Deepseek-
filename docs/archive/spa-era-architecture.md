# Architecture

How a message gets from the composer to DeepSeek, and why it is shaped this way.

## The one rule

**Every DeepSeek API call is a plain same-origin `fetch`.** There is no bridge,
no callback round trip, and no server of our own on the chat path.

```
composer
  └─ src/lib/send-chat.ts
       └─ src/lib/deepseek/api.ts
            ├─ POST /api/v0/chat_session/create
            ├─ POST /api/v0/chat/create_pow_challenge
            ├─ solvePow()                      ← src/lib/deepseek/pow-browser.ts + ds/sha3_wasm_bg.wasm
            └─ POST /api/v0/chat/completion    → SSE, parsed by parse-sse.ts
```

`/api/v0` is **relative on purpose**. It resolves to the right place in both
shells without the client knowing where it is running.

## Why same-origin

DeepSeek does not allow cross-origin API calls:

| probe | result |
|---|---|
| `OPTIONS /api/v0/chat_session/create` | **403** |
| `POST` response headers | `access-control-allow-credentials: true`, **no `Access-Control-Allow-Origin`** |

So a WebView hosted anywhere else cannot send an `Authorization` header to the
API. The fix is to stop being a different origin.

**Android** — `MainActivity` points `WebViewAssetLoader` at `chat.deepseek.com`
instead of `appassets.androidplatform.net`, so the bundled SPA is served from
`https://chat.deepseek.com/android-spa.html`. Requests to `/api/v0/*` are then
same-origin (never preflighted), carry the real cookies, and are
indistinguishable from the official web app's traffic. The asset loader only
owns paths it actually has; `/api/*` is explicitly excluded and falls through to
the network.

**Web (`npm run dev`)** — the Vite dev server proxies `/api/v0` to
`https://chat.deepseek.com`. Same code, same relative path.

## What still uses the native bridge

**Sign-in only.** `POST /api/v0/users/login` is behind an AWS WAF JS challenge
(`202` + `x-amzn-waf-action: challenge`), which needs a real browser to solve.
`src/lib/deepseek/client-direct.ts` hands the credentials to the DeepSeek
WebView and then **verifies the token with `/users/current`** before accepting
it — a scraped token is never trusted blind.

Everything else the old bridge did (`dsChatNative`, `requestPowSolve`,
`onPowSolved`, `onChatChunk`, …) has been removed from the client.

## The proof-of-work contract

`sha3_wasm_bg.wasm` exports `wasm_solve(retptr, chPtr, chLen, pfxPtr, pfxLen, budget)`.
Verified by disassembly and by `src/lib/deepseek/pow.test.ts`:

- `challenge` is **hex**, and is hex-decoded inside the module. A base64 value
  makes it bail instantly.
- `difficulty` is an **iteration budget**, not a leading-zero-bit difficulty.
- The loop compares `SHA3-256(prefix ++ decimal(counter))` against the first 32
  bytes of the decoded challenge, where `prefix = "${salt}_${expire_at}_"`.
- `Int32[retptr] === 1` means solved; the answer is the `Float64` at `retptr+8`.

`api.ts` validates the challenge before solving and retries **once** on a
rejected proof (`40300`/`40301`) with a fresh challenge.

## Error handling

Errors are surfaced, never masked. Two rules came out of debugging this project:

1. DeepSeek reports business errors as **HTTP 200 with a JSON envelope**
   (`{"code":40003,...}`), so `res.ok` alone is meaningless — `completeStream`
   checks the content type.
2. A failed call must name its cause in the UI. The generic
   *"DeepSeek is unavailable right now."* string hid the real failure for 86
   builds; see `docs/DIAGNOSIS-AND-FIX-PLAN.md`.

## Testing

```bash
npx tsx --test src/lib/deepseek/pow.test.ts   # WASM contract, planted-answer recovery
npx tsx --test src/lib/deepseek/api.test.ts   # client: envelope, PoW header, retry, expiry
npm run typecheck
```

`pow.test.ts` mints challenges with the same WASM the app ships and asserts the
solver recovers the planted counter, so a regression in the calling convention
fails in CI instead of in production.
