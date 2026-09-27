export type HapticKind = "send" | "success" | "error" | "select" | "open";

const PATTERNS: Record<HapticKind, number | number[]> = {
  send: [12, 30, 18],
  success: [8, 40, 16, 40, 24],
  error: [40, 40, 60],
  select: 8,
  open: [6, 20, 10],
};

export function performHaptic(kind: HapticKind, enabled: boolean): void {
  if (!enabled || typeof navigator === "undefined") return;
  const vibrate = navigator.vibrate?.bind(navigator);
  if (!vibrate) return;
  try {
    vibrate(PATTERNS[kind]);
  } catch {
    /* ignore */
  }
}
