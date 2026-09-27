#!/usr/bin/env bash
# Super DeepSeek — Android emulator smoke (Layer 3 of the QA plan).
#
# Boots the real debug APK on the CI emulator, waits out the launch cap, then
# checks: the process is alive, the engine reached the page, and there is no
# crash/ANR. Screenshots and logcat go to /tmp/emulator-smoke, uploaded as CI
# artifacts (never committed).
set -uo pipefail
OUT=/tmp/emulator-smoke
mkdir -p "$OUT"

APK=$(ls android/app/build/outputs/apk/debug/*.apk 2>/dev/null | head -1)
if [ -z "$APK" ]; then
  echo "::error::no debug APK found — build assembleDebug first"
  exit 1
fi

adb wait-for-device
adb shell input keyevent 82 >/dev/null 2>&1 || true
adb shell settings put global window_animation_scale 0 >/dev/null 2>&1 || true
adb shell settings put global transition_animation_scale 0 >/dev/null 2>&1 || true
adb shell settings put global animator_duration_scale 0 >/dev/null 2>&1 || true

echo "== install $APK =="
adb install -r "$APK" > "$OUT/install.log" 2>&1 || {
  echo "::error::adb install failed"; cat "$OUT/install.log"; exit 1;
}

echo "== launch com.superdeepseek.app/.MainActivity =="
adb logcat -c || true
adb shell am start -W -n com.superdeepseek.app/.MainActivity > "$OUT/launch.log" 2>&1
# The app caps its own launch screen at 18 s; give the engine a moment after.
sleep 25

adb shell screencap -p /sdcard/smoke.png >/dev/null 2>&1
adb pull /sdcard/smoke.png "$OUT/screen.png" >/dev/null 2>&1 || true
adb shell screencap -p /sdcard/smoke2.png >/dev/null 2>&1
adb pull /sdcard/smoke2.png "$OUT/screen2.png" >/dev/null 2>&1 || true
adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true

echo "== checks =="
STATUS=0

if adb shell pidof com.superdeepseek.app > "$OUT/pid.txt" 2>/dev/null && [ -s "$OUT/pid.txt" ]; then
  echo "process alive: $(cat "$OUT/pid.txt")"
else
  echo "::error::app process is not alive after launch (crash during startup?)"
  STATUS=1
fi

if grep -q "FATAL EXCEPTION\|ANR in com.superdeepseek.app\|Force finishing activity com.superdeepseek.app" "$OUT/logcat.txt"; then
  echo "::error::crash or ANR detected for com.superdeepseek.app"
  grep -B2 -A12 "FATAL EXCEPTION\|ANR in com.superdeepseek.app" "$OUT/logcat.txt" | head -40
  STATUS=1
else
  echo "no crash/ANR markers"
fi

# Engine markers — page load can legitimately be the login/WAF screen inside
# CI, so a missing marker is a warning, not a failure (report-only job).
if grep -q "Official WebView loaded\|injected.js done\|engine already present" "$OUT/logcat.txt"; then
  echo "engine markers present"
else
  echo "::warning::engine markers not in logcat — the page may still be the login/WAF screen in CI"
fi

echo "smoke done (status=$STATUS) — artifacts in $OUT"
ls -la "$OUT"
exit $STATUS
