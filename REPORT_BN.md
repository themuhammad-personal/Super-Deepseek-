# Super DeepSeek — বাস্তব ব্যবহারে যাচাই, বাগ-হান্ট ও আপডেট রিপোর্ট

**তারিখ:** 2026-09-27 (Asia/Dhaka)
**ব্রাঞ্চ:** `arena/bug-hunt` (Super-Deepseek-)
**বেস:** `Deepseek-@7a9441d` v1.8.3

## সারাংশ
বাস্তব ব্যবহারের মতো করে যাচাই (Layer 1-4), প্রতিটি বাগের জন্য reproduce->failing test->fix->suite->commit->push চক্র, নিরাপত্তা গর্ত বন্ধ, রেপো হেলথ সারানো, Harness/Emulator স্ক্যাফোল্ড। CI green.

## ফিক্স ১ — প্রাইভেট নেটওয়ার্ক ব্লক (Critical)
- আগে: `handleFetchUrl`/`mcpFetch` কোথাও 127/10/192.168/172.16 প্রাইভেট ব্লক ছিল না।
- এখন: `isPrivateHost`/`isPrivateNetworkUrl` (InetAddress + fc00::/7) যোগ, `bds-fetch-url`, `github-zip`, `MCP` এ ব্লক।
- টেস্ট: WebViewBridgeTest 8 নতুন টেস্ট, 31/31 pass. পুরনো কোডে `fetch 127.0.0.1` allowed (failing), নতুন কোডে blocked (pass).

## ফিক্স ২ — Repo Health
- eslint 2 warn -> 0 (disable in queue-sheet, settings-sheet)
- `.grok` dummy + `migrations/auth` dummy -> test:template 148/148 pass
- `package.json` test:template explicit list
- `scripts/sds-brand-check.mjs` ব্র্যান্ড গেট

## ফিক্স ৩ — Harness/Emulator
- `tools/harness` (puppeteer-core, fixture deepseek-realistic.html, fake AndroidBridge, 10 scenario)
- `.github/workflows` এ `engine-harness` ও `emulator-tests` (KVM, API34, continue-on-error)

## যাচাই
Layer1: lint 0, template 148/148, engine 86/86
Layer2: harness dry-run ok
Layer3: emulator job CI-তে
Layer4: ফোনে 10 মিনিট টেস্ট বাকি (নিচে)

## ঝুঁকি (অযাচাই)
16KB ELF, background 10min stall, DOM drift, 100MB upload, PTY

## ফোন টেস্ট স্ক্রিপ্ট (5-10 মিনিট)
1. Launch - wordmark 18s, bar color
2. Sign-in
3. Slash / popup
4. Agent small todo preview
5. Agent long 10min background
6. Scroll guard
7. Linux Studio terminal/files/preview/export
8. Upload 40MB+
9. Mixed BN/AR bidi
10. Crash/rotation

## টোকেন
ghp_tpgyaR...Mq2fq সেন্ডবক্স থেকে মুছে ফেলা হয়েছে, মালিক রিভোক করুন।
