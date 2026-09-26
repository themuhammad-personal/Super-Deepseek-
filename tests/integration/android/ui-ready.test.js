// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  signalUiReady,
  signalUiReadyAfterPaint,
  UI_READY_SIGNALLED_KEY,
} from "../../../src/android/ui-ready.js";

function installBridge(bridge = {}) {
  window.AndroidBridge = bridge;
  return bridge;
}

describe("signalUiReady (Round-2 B.7)", () => {
  beforeEach(() => {
    delete window.AndroidBridge;
    delete window[UI_READY_SIGNALLED_KEY];
  });

  afterEach(() => {
    delete window.AndroidBridge;
    delete window[UI_READY_SIGNALLED_KEY];
  });

  it("calls the bridge once per page load", () => {
    const uiReady = vi.fn();
    installBridge({ uiReady });

    expect(signalUiReady("test")).toBe(true);
    expect(signalUiReady("again")).toBe(false);
    expect(uiReady).toHaveBeenCalledTimes(1);
  });

  it("stays silent without the native bridge (Chrome build)", () => {
    expect(signalUiReady("test")).toBe(false);
    expect(window[UI_READY_SIGNALLED_KEY]).toBeUndefined();
  });

  it("ignores a bridge without the uiReady method (older shells)", () => {
    installBridge({ getStorage: () => null });
    expect(signalUiReady("test")).toBe(false);
  });

  it("does not throw when the native call fails", () => {
    installBridge({
      uiReady: () => {
        throw new Error("bridge gone");
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => signalUiReady("test")).not.toThrow();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("waits for two animation frames before signalling", () => {
    const uiReady = vi.fn();
    installBridge({ uiReady });
    const frames = [];
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      frames.push(callback);
      return frames.length;
    };

    try {
      signalUiReadyAfterPaint("test");
      expect(uiReady).not.toHaveBeenCalled();

      frames.shift()(); // frame 1 → schedules frame 2
      expect(uiReady).not.toHaveBeenCalled();

      frames.shift()(); // frame 2 → signal
      expect(uiReady).toHaveBeenCalledTimes(1);
    } finally {
      window.requestAnimationFrame = originalRaf;
    }
  });

  it("falls back to a task when requestAnimationFrame is missing", async () => {
    const uiReady = vi.fn();
    installBridge({ uiReady });
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = undefined;

    try {
      signalUiReadyAfterPaint("test");
      expect(uiReady).not.toHaveBeenCalled();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(uiReady).toHaveBeenCalledTimes(1);
    } finally {
      window.requestAnimationFrame = originalRaf;
    }
  });
});
