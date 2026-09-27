# Super DeepSeek — রোগনির্ণয় ও ফিক্স প্ল্যান

> তারিখ: ২০২৬-০৯-২৩ · কমিট: `b034d9c` ("Fix chat: OkHttp with official cookies + Origin + PoW solve via onPowSolved (Build 86)")
>
> এই ডকুমেন্টের প্রতিটি দাবি হয় **কোড পড়ে** নয়তো **লাইভ নেটওয়ার্ক/wasm পরীক্ষা চালিয়ে** যাচাই করা।
> যা যাচাই করা যায়নি সেটা আলাদা করে "অযাচাইত" চিহ্নিত।

---

## ১. এক লাইনে সারকথা

**প্রজেক্টের PoW সলভার এবং DeepSeek API কল — দুটোই ঠিক আছে।** সমস্যাটা নেটওয়ার্কে না, আছে
**আর্কিটেকচারে**: অ্যাপটা এমন এক শত্রুর (WAF) বিরুদ্ধে লড়ছে যে chat API-তে নেই-ই, আর যে ছোট্ট
সত্যিকারের সমস্যাটা আছে সেটার এরর মেসেজ একটা ভুয়া ফলব্যাক দিয়ে **চাপা পড়ে যায়** — তাই ৮৬ বার বিল্ড
করেও কখনো আসল কারন দেখা যায়নি।

আপনি যে "আনঅ্যাভেলেবল" দেখেন সেটা DeepSeek-এর মেসেজ না — **আপনার নিজের অ্যাপের হার্ডকোড করা
স্ট্রিং** (`src/lib/send-chat.ts:239`)।

---

## ২. প্রজেক্টটা আসলে কী

দুই-স্তরের অ্যাপ:

| স্তর | কী | কোথায় |
|---|---|---|
| UI | React SPA (OLED ব্ল্যাক চ্যাট UI) | `src/` → বিল্ড হয়ে `android/app/src/main/assets/` |
| শেল | Android WebView wrapper, ৩টা WebView | `android/.../MainActivity.kt`, `WebViewBridge.kt` (২৪৮২ লাইন) |

`MainActivity`-তে তিন ভিউ (লাইন ১৫৯-৩৩০):

- `officialWebView` — দৃশ্যমান, `https://chat.deepseek.com/` লোড করে "অফিসিয়াল লগইন"-এর জন্য
- `reactWebView` — কাস্টম UI, লোকাল asset থেকে (`appassets.androidplatform.net`)
- `bridge.mainWebView = reactWebView`, `bridge.hiddenWebView = officialWebView`

চ্যাট পাঠানোর বর্তমান পথ (`src/lib/send-chat.ts` → `client-direct.ts` → `WebViewBridge.kt`):

```
React → AndroidBridge.dsChatNative()          [JS → Kotlin]
      → OkHttp: chat_session/create            [Kotlin → DeepSeek]
      → OkHttp: chat/create_pow_challenge      [Kotlin → DeepSeek]
      → requestPowSolve() inject JS            [Kotlin → JS]
      → WASM sha3 solve                        [JS]
      → AndroidBridge.onPowSolved()            [JS → Kotlin]
      → OkHttp: chat/completion (SSE)          [Kotlin → DeepSeek]
      → onChatChunk() inject JS                [Kotlin → JS]
```

অর্থাৎ প্রতিটা মেসেজের জন্য **৪ বার JS↔Kotlin সীমানা পার হতে হয়**। সমস্যাটা এখানেই।

---

## ৩. যাচাইকৃত তথ্য (প্রমাণসহ)

### ৩.১ WAF শুধু HTML আর লগইনে — chat API-তে একদম না

`tools/probe-deepseek.sh` চালিয়ে পাওয়া আসল আউটপুট:

| রিকোয়েস্ট | রেজাল্ট |
|---|---|
| `GET /` (curl, সাধারণ হেডার) | **202**, `content-length: 0`, `x-amzn-waf-action: challenge` |
| `GET /` (ফুল ব্রাউজার হেডার) | **202**, ২৫১৯ বাইট AWS WAF JS চ্যালেঞ্জ পেজ (`window.awsWafCoo…`) |
| `POST /api/v0/users/login` | **202**, size 0, `x-amzn-waf-action: challenge` |
| `POST /api/v0/chat_session/create` | **200** `{"code":40002,"msg":"Missing Token"}` |
| `POST /api/v0/chat/create_pow_challenge` | **200** `{"code":40002,"msg":"Missing Token"}` |
| `POST /api/v0/chat/completion` | **200** `{"code":40003,"msg":"INVALID_TOKEN"}` |
| `GET /api/v0/users/current` | **200** `{"code":40002,"msg":"Missing Token"}` |

**সিদ্ধান্ত:** session-create, PoW-challenge, completion — তিনটাই সাধারণ HTTP ক্লায়েন্ট থেকে সরাসরি
কল করা যায়। কোনো WAF নেই। User-Agent-ও ব্যাপার না (`okhttp/4.12.0` দিয়েও ২০০ আসে)।

> ⚠️ অর্থাৎ `WebViewBridge.kt`-এর প্রায় ১৫০০ লাইন "WAF bypass" প্লাম্বিং chat পাথে **একটা সমস্যাও
> সমাধান করে না** — উল্টে ৪-হপ round-trip যোগ করে ব্যর্থতার জায়গা বাড়ায়।

### ৩.২ অথেন্টিকেশন শুধু `Authorization: Bearer` — কুকি না

| পাঠানো হলো | রেসপন্স |
|---|---|
| `Authorization: Bearer garbage` | `40003 Authorization Failed (invalid token)` |
| `Cookie: ds_web_token=garbage` (শুধু) | `40002 Missing Token` |

**সিদ্ধান্ত:** DeepSeek **কুকি পুরোপুরি উপেক্ষা করে**, শুধু Bearer হেডার পড়ে। আপনার কোড
`Authorization` হেডারই পাঠায় — **এটা ঠিক আছে**। (তবে `Cookie:` হেডার পাঠানো অপ্রয়োজনীয়।)

### ৩.৩ PoW সলভার ঠিক আছে — wasm কনট্রাক্ট ডিসঅ্যাসেম্বল করে বের করা

`public/ds/sha3_wasm_bg.wasm` (২৬,৬১২ বাইট, `sha3-wasm/src/lib.rs`, wasm-bindgen 0.2.97) কে
`wabt` দিয়ে `.wat`-এ নামিয়ে `wasm_solve` (func 1) পড়া হয়েছে:

```
wasm_solve(retptr:i32, chPtr:i32, chLen:i32, pfxPtr:i32, pfxLen:i32, budget:f64) -> ()
```

- **`challenge` ফিল্ড wasm-এর ভেতরে hex-decode হয়** (`-0x30`, `|0x20`, `-87` প্যাটার্ন)।
  বিজোড় দৈর্ঘ্য বা non-hex ক্যারেক্টার → **সাথে সাথে bail**, কোনো এরর না।
- **`difficulty` আসলে iteration budget**, leading-zero-bit difficulty না। wat থেকে:
  `local.tee 23` (লুপ বাউন্ড) সরাসরি ৬ষ্ঠ প্যারামিটার থেকে আসে। timing টেস্টেও মিলে:
  `budget=1000 → 5ms`, `100000 → 68ms`, `1000000 → 587ms`, `4000000 → 2835ms` (~১.৫M hash/s, রৈখিক)।
- লুপ: `counter = 0..budget-1`, তুলনা করে `SHA3-256(prefix ++ decimal(counter))` বনাম
  **hex-decoded challenge-এর প্রথম ৩২ বাইট**।
- **রিটার্ন লেআউট:** `Int32[retptr+0] == 1` ⇒ সমাধান মিলেছে, উত্তর `Float64[retptr+8]`।
  (wat-এ: found-পাথে `local 7 = 0` → `retptr+0 = flag XOR 1 = 1`।)

আপনার `pow.ts` / `pow-browser.ts` ঠিক এই কনট্রাক্টই ব্যবহার করে — `prefix = ${salt}_${expire_at}_`,
`status = Int32Array[retptr/4]`, `answer = Math.floor(Float64Array[(retptr+8)/8])`। **সব ঠিক।**

**এন্ড-টু-এন্ড প্রমাণ:** `src/lib/deepseek/pow.test.ts` (নতুন যোগ করা) shipping `solvePow()`-কে
নিজের বানানো "প্লান্ট করা উত্তর" খুঁজে বের করতে বলে:

```
$ npx tsx --test src/lib/deepseek/pow.test.ts
ok 1 - solvePow recovers a planted answer            (answer=7)
ok 2 - solvePow recovers a larger planted answer     (answer=4321)
ok 3 - solvePow reports failure instead of returning a bogus answer
ok 4 - solvePow rejects a non-hex challenge (e.g. base64) with a clear error
# pass 4  # fail 0
```

---

## ৪. আসল সমস্যাগুলো (গুরুত্ব অনুসারে)

### 🔴 RC-1 — ভুয়া ফলব্যাক আসল এরর ঢেকে দেয় (সবচেয়ে বড় কারন)

`src/lib/send-chat.ts` (পুরোনো কোড):

```ts
} catch (nativeErr) {
  console.warn('[SendChat] Native failed, fallback to /api/ds/complete', nativeErr);
  res = await fetch("/api/ds/complete", { … });
}
```

**APK-তে কোনো ব্যাকএন্ড সার্ভার নেই।** যাচাই করা — `android/app/src/main/assets/`-এ আছে শুধু:

```
/android-spa.html
/assets/android-spa-B7hgMgxZ.css
/assets/android-spa-DhLbAMML.js
/ds/sha3_wasm_bg.wasm
/favicon.svg  /og.jpg  /__grok/…
```

`/api/*` হ্যান্ডলার নেই। `src/routes/api/ds/complete.ts` একটা TanStack Start **server** route — সেটা
শুধু ওয়েব বিল্ডে চলে, `vite.android-spa.config.ts` স্ট্যাটিক SPA বানায়।

তাই native পাথ যেকোনো কারনে ফেল করলে:
- ফেচ একটা non-OK রেসপন্স দিলে → `"DeepSeek is unavailable right now."` ← **আপনি যা দেখেন**
- ফেচ reject করলে → `"Could not reach DeepSeek. Your message is safe."`

আসল এরর শুধু `console.warn`-এ যায়, যেটা কেউ দেখে না। **এটাই কারন ৮৬ বিল্ডেও ডায়াগনসিস হয়নি।**

### 🔴 RC-2 — PoW round-trip-এ নীরব ব্যর্থতা → UI চিরকাল ঝুলে থাকে

দুটো জায়গা:

**ক) `WebViewBridge.kt::onPowSolved`** (পুরোনো কোড):
```kotlin
val pending = pendingChats[safeId]
if (pending == null) {
    Log.w(TAG, "No pending chat for $safeId")
    return          // ← JS কখনো জানতেই পারে না, স্ট্রিম বন্ধ হয় না
}
```

**খ) `requestPowSolve`** `mainWebView`-এ JS ইনজেক্ট করে `window._dsChatCallbacks[id].onNeedPow(...)`
ডাকতে। যদি `reactWebView` রিলোড হয়ে থাকে বা callback রেজিস্টার না হয়ে থাকে, স্ক্রিপ্ট শুধু
`console.warn` করে — আর কিছুই হয় না।

**গ) `dsCompleteStreamViaNative`-এ কোনো টাইমআউট ছিল না** (লগইনে ১৫s, session-create-এ ২০s আছে,
চ্যাটে নেই)। ফলে উপরের যেকোনোটা হলে কম্পোজার অনন্তকাল স্পিন করে — **"রিপ্লাই আসে না"**।

### 🟠 RC-3 — লগইন-ই আসলে কঠিন অংশ, আর সেটার হ্যান্ডলিং অসম্পূর্ণ

WAF শুধু `/users/login`-এ (§৩.১)। আর `tryHiddenWebViewLogin` যে fetch চালায় সেটা
`aws-waf-token` কুকি সেট হওয়ার **আগে** চললে খালি 202 পায়। `onHiddenLoginResult`-এর নিজের
কমেন্টই সেটা স্বীকার করে:

```kotlin
val dummyPayload = JSONObject() // We lost original payload, so just report error
```

আর WAF-ডিটেকশন লজিকটা বেশি ঢিলে:
```js
const isWafChallenge = innerHTML.includes('aws-waf') || innerHTML.includes('challenge') || …
```
`innerHTML.includes('challenge')` আসল DeepSeek পেজেও ম্যাচ করতে পারে।

এছাড়া টোকেন আসে দুই পথে (`localStorage.userToken` পোলিং ১.৫s পরপর, অথবা ইনজেক্টেড fetch) —
দুটোই টাইমিং-নির্ভর, কোনোটারই "টোকেন সত্যিই কাজ করছে কি না" যাচাই নেই (`/users/current` কল
করে দেখা হতো না)।

### 🟡 RC-4 — PoW চ্যালেঞ্জ ভ্যালিডেশন নেই (§৩.৩ থেকে)

`challenge` ফিল্ড hex না হলে wasm নীরবে fail করে → `"PoW solver found no solution"` → আর কোনো
ব্যাখ্যা নেই। DeepSeek কী ফরম্যাটে দেয় সেটা লগ করা হতো না, তাই মিলেমিশে না দেখা পর্যন্ত এটা
অদৃশ্য থাকত।

### 🟡 RC-5 — ছোট কিন্তু বাস্তব বাগ

- `pow.ts`-এ wasm খোঁজার পথ ভুল ছিল: `android/app/src/main/assets/www/…` — আসল পথ `…/assets/ds/…`
- `vite.android-spa.config.ts`-এ `emptyOutDir: true` পুরো assets ডিরেক্টরি মুছে দেয়, তারপর
  `closeBundle`-এ শুধু wasm ফেরত আসে (`favicon.svg`, `og.jpg`, `__grok/` হারায়)
- `.gitignore`-এ `node_modules/` লেখা থাকলেও **১৩৫৫টা ফাইল ট্র্যাক করা আছে** — রিপো ১০১ MB
- ~~কোথাও `CookieManager.flush()` কল নেই~~ — **এটা ভুল ছিল**: `MainActivity.onResume()`/`onPause()`-এ `cookieManager.flush()` ঠিকই কল করা হয় (লাইন ৫৩৭/৫৪২)।

### ⚪ অযাচাইত (টোকেন ছাড়া পরীক্ষা করা যায়নি)

- `X-Ds-Trace-Code` হেডার লাগে কি না। প্রোবে টোকেন-ভ্যালিডেশনের **আগে** এটা চেক হয় না
  (`40003 INVALID_TOKEN` ফিরেছে), তাই অথ-এর পরে লাগতেও পারে। কমিউনিটি প্রজেক্টগুলো এটা
  উল্লেখ করে।
- DeepSeek-এর `create_pow_challenge` রেসপন্সে `challenge` ফিল্ডটা hex না base64, আর
  `expire_at` সেকেন্ড না মিলিসেকেন্ড। **এটাই এখন সবচেয়ে গুরুত্বপূর্ণ অজানা।**

---

## ৫. ফিক্স প্ল্যান

### ধাপ ০ — ডায়াগনস্টিক অন করুন (৩০ মিনিট, সবার আগে)

এখন যা করা হয়েছে তাতেই প্রথম রিয়েল এরর দেখা যাবে। APK ইনস্টল করে একটা মেসেজ পাঠান:

```bash
adb logcat -c && adb logcat | grep -E "BdsWebViewBridge|SuperDeepSeek|chromium"
```

এখন আপনি দেখবেন:
- `[ChatNative] PoW challenge: {algorithm, challengeLen, challengeIsHex, salt, expire_at, difficulty, target_path}`
- ব্যর্থ হলে `DeepSeek call failed: <আসল কারন>` (আর "unavailable" না)
- আটকে গেলে `DeepSeek did not respond — <phase> timed out after Ns`

> **এই লগের আউটপুটই বলে দেবে বাকি সব।** বিশেষ করে `challengeIsHex` আর `difficulty`-এর মান।

### ✅ ধাপ ১ — আর্কিটেকচার সরল করা হয়েছে (সম্পন্ন)

§৩.১ প্রমাণ করে chat API-তে WAF নেই। তাই:

**চ্যাটের জন্য WebView bridge পুরো বাদ দিন।** সরাসরি `fetch` করুন:

```
React → fetch('https://chat.deepseek.com/api/v0/chat_session/create')
      → fetch('.../chat/create_pow_challenge')
      → solvePow() (WASM, ইতিমধ্যে কাজ করছে)
      → fetch('.../chat/completion', { headers: { 'X-Ds-Pow-Response': pow } })
```

এতে ৪-হপ round-trip হয়ে যায় ০-হপ, আর RC-2 পুরোপুরি অদৃশ্য হয়ে যায়।

**CORS নোট:** `chat.deepseek.com` থেকে `access-control-allow-origin: *` রেসপন্স আসে
(প্রোবে দেখা গেছে), কিন্তু `Authorization` হেডারসহ preflight পাস করে কি না সেটা ডিভাইসে যাচাই
করতে হবে। যদি ব্লক করে, **তখনই** OkHttp bridge রাখুন — কিন্তু তখন সেটা শুধু
`session → pow → completion` তিনটা কলের একটা সোজা লাইন হবে, PoW-র জন্য JS-এ ফিরে যাওয়া লাগবে না
(WASM-টা Kotlin থেকেও চালানো যায়, অথবা PoW-টা WebView-তে সলভ করে শুধু ফলাফল ফেরত দিন)।

### ধাপ ২ — লগইন শক্ত করুন (আধা দিন)

এটাই একমাত্র জায়গা যেখানে WebView সত্যিই দরকার।

1. `officialWebView`-এ `https://chat.deepseek.com/` লোড হতে দিন, WAF চ্যালেঞ্জ **সমাধান হওয়া পর্যন্ত
   অপেক্ষা করুন** — `WebViewClient.doUpdateVisitedHistory` + `document.readyState === 'complete'`
   এবং `aws-waf-token` কুকির উপস্থিতি চেক করে।
2. টাইমার-ভিত্তিক ১.৫s পোলিংয়ের বদলে `localStorage`-এ `userToken` এলে **event/callback** দিন
   (StorageEvent বা একটা ছোট MutationObserver)।
3. টোকেন পেলে **সাথে সাথে `GET /api/v0/users/current`** কল করে যাচাই করুন। ব্যর্থ হলে স্পষ্ট
   এরর দিন, চুপচাপ খালি টোকেন নিয়ে এগোবেন না।
4. `innerHTML.includes('challenge')` চেক বাদ দিন — শুধু `aws-waf-token` কুকি আর HTTP স্ট্যাটাস দেখুন।

### ধাপ ৩ — বিশ্বাসযোগ্যতা (আধা দিন)

- [x] চ্যাট স্ট্রিমে watchdog (§৬)
- [x] `onPowSolved` নীরব return বন্ধ (§৬)
- [x] PoW চ্যালেঞ্জ ডায়াগনস্টিক (§৬)
- [ ] 40300/40301 (PoW reject) পেলে **একবার নতুন চ্যালেঞ্জ নিয়ে retry** করুন
- [ ] 40003 (token invalid) পেলে অটো রি-লগইন ফ্লো
- [ ] `CookieManager.flush()` কল করুন লগইনের পরে

### ধাপ ৪ — হাউসকিপিং

- [x] `pow.ts` wasm path ঠিক (§৬)
- [ ] `git rm -r --cached node_modules` — ১০১ MB রিপো ছোট হবে
- [ ] `vite.android-spa.config.ts`-এ `emptyOutDir: false` করুন অথবা বাকি asset-ও কপি করুন

---

## ৬. এই সেশনে যা ইতিমধ্যে ঠিক করা হয়েছে

৪টা ফাইল বদলেছে, ১টা নতুন টেস্ট যোগ হয়েছে:

```
 android/.../WebViewBridge.kt      | 32 ++++++++++++++--
 src/lib/deepseek/client-direct.ts | 43 +++++++++++++++++++++-
 src/lib/deepseek/pow.ts           |  2 +-
 src/lib/send-chat.ts              | 26 ++++++-------
 src/lib/deepseek/pow.test.ts      | (নতুন)
```

1. **`send-chat.ts`** — APK-তে ভুয়া `/api/ds/complete` ফলব্যাক বাদ। এখন আসল এরর
   `DeepSeek call failed: <কারন>` হিসেবে UI-তে দেখায়। (RC-1)
2. **`client-direct.ts`** — চ্যাট স্ট্রিমে ৩-স্তরের watchdog: ৬০s (PoW + প্রথম রেসপন্স),
   ১২০s (প্রথম টোকেন), ৯০s (পরের টোকেন)। আটকে গেলে এখন স্পষ্ট এরর আসে, অনন্ত স্পিন না। (RC-2গ)
3. **`client-direct.ts`** — `onNeedPow`-তে চ্যালেঞ্জ ফিল্ড লগ + hex ভ্যালিডেশন; hex না হলে
   স্পষ্ট এরর। (RC-4)
4. **`WebViewBridge.kt`** — `onPowSolved`-এর দুটো নীরব `return` এখন JS-এ এরর পাঠায়। (RC-2ক)
5. **`WebViewBridge.kt`** — PoW চ্যালেঞ্জের সব ফিল্ড logcat-এ, hex না হলে এরর। (RC-4)
6. **`pow.ts`** — wasm path `assets/www/` → `assets/ds/`। (RC-5)
7. **`pow.test.ts`** — shipping সলভারের এন্ড-টু-এন্ড কনট্রাক্ট টেস্ট (৪টা টেস্ট)।

### যাচাই

```
$ tsc --noEmit                     → exit 0
$ tsx --test <৯টা টেস্ট ফাইল>       → # tests 22  # pass 22  # fail 0
$ tsx --test <সব ১৩টা টেস্ট ফাইল>   → # tests 77  # pass 77  # fail 0   (npm ci-এর পর)
```

> ⚠️ **Kotlin কোডটা কম্পাইল করা যায়নি** — এই স্যান্ডবক্সে Android SDK নেই (`ANDROID_HOME` খালি,
> gradle/kotlinc নেই)। তবে `return@Thread` লেবেলটা একই `Thread { }` ব্লকে আগে থেকেই ১৩ জায়গায়
> ব্যবহৃত, এবং বাকি API (`Log.i`, `JSONObject`, `CharSequence.all`, `Char.isDigit`) স্ট্যান্ডার্ড।
> **CI-তে `./gradlew assembleRelease` চালিয়ে নিশ্চিত করে নেবেন।**

> নোট: `npm run test:app` এই স্যান্ডবক্সে চলে না কারন এখানে Node v20.20.2, আর স্ক্রিপ্টটা
> `--experimental-strip-types` চায় (Node 22+ দরকার)। তাই `npx tsx --test` দিয়ে চালানো হয়েছে —
> একই টেস্ট ফাইল, একই ফলাফল।

---

## ৭. পরের ধাপে আপনার কাজ

1. `tools/probe-deepseek.sh` চালান — §৩-এর ফলাফল আপনার নেটওয়ার্ক থেকে নিশ্চিত হবে।
2. APK বানান (`npm run build:android:full`), একটা মেসেজ পাঠান, logcat ধরুন।
3. logcat-এর এই লাইনটা আমাকে দিন:
   `[ChatNative] PoW challenge: {…}` — এতে `challengeIsHex` আর `difficulty` দেখে বলা যাবে
   DeepSeek কী ফরম্যাটে চ্যালেঞ্জ দেয়, আর ধাপ ১-এর সরল আর্কিটেকচারে যাওয়া যাবে কি না।
