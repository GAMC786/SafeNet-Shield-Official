import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Script } from "node:vm";
import test from "node:test";

const indexHtml = readFileSync(
  path.resolve(process.cwd(), "client/index.html"),
  "utf8",
);
const scriptSource = indexHtml.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];

assert.ok(scriptSource, "The soundtrack controller must be present in the HTML shell.");

type EventHandler = (event: { type: string }) => void;

class MockAudioElement {
  muted = false;
  paused = true;
  loop = false;
  ended = false;
  currentTime = 0;
  volume = 1;
  error: { code: number } | null = null;
  playCalls = 0;
  loadCalls = 0;
  private listeners = new Map<string, EventHandler[]>();

  addEventListener(type: string, handler: EventHandler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type: string) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ type });
    }
  }

  play() {
    this.playCalls += 1;
    this.paused = false;
    this.ended = false;
    this.dispatch("play");
    this.dispatch("playing");
    return Promise.resolve();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.dispatch("pause");
  }

  load() {
    this.loadCalls += 1;
    this.error = null;
    this.ended = false;
    this.currentTime = 0;
    this.paused = true;
    this.dispatch("pause");
  }
}

function createHarness(initiallyMuted = false) {
  let now = 1000;
  let nextTimerId = 1;
  const timeouts = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  const storage = new Map<string, string>();
  const windowListeners = new Map<string, EventHandler[]>();
  const documentListeners = new Map<string, EventHandler[]>();
  const audio = new MockAudioElement();

  if (initiallyMuted) {
    storage.set("safenet-soundtrack-muted", "true");
  }

  class TestDate extends Date {
    static now() {
      return now;
    }
  }

  const addListener = (
    listeners: Map<string, EventHandler[]>,
    type: string,
    handler: EventHandler,
  ) => {
    const handlers = listeners.get(type) ?? [];
    handlers.push(handler);
    listeners.set(type, handlers);
  };

  const window: Record<string, any> = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    addEventListener: (type: string, handler: EventHandler) =>
      addListener(windowListeners, type, handler),
    dispatchEvent: (event: { type: string }) => {
      for (const handler of windowListeners.get(event.type) ?? []) {
        handler(event);
      }
      return true;
    },
    setTimeout: (callback: () => void) => {
      const id = nextTimerId++;
      timeouts.set(id, callback);
      return id;
    },
    clearTimeout: (id: number) => timeouts.delete(id),
    setInterval: (callback: () => void) => {
      const id = nextTimerId++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id: number) => intervals.delete(id),
  };
  const document = {
    hidden: false,
    getElementById: (id: string) =>
      id === "safenet-soundtrack-audio" ? audio : null,
    addEventListener: (type: string, handler: EventHandler) =>
      addListener(documentListeners, type, handler),
  };

  new Script(scriptSource).runInNewContext({
    window,
    document,
    HTMLAudioElement: MockAudioElement,
    Date: TestDate,
  });

  return {
    audio,
    document,
    storage,
    window,
    advanceTime: (milliseconds: number) => {
      now += milliseconds;
    },
    runNextTimeout: () => {
      const next = timeouts.entries().next().value as
        | [number, () => void]
        | undefined;
      assert.ok(next, "Expected a scheduled soundtrack retry.");
      timeouts.delete(next[0]);
      next[1]();
    },
    runWatchdogs: () => {
      for (const callback of intervals.values()) callback();
    },
    pendingTimeouts: () => timeouts.size,
  };
}

test("restarts playback after an unexpected pause while enabled", () => {
  const harness = createHarness();
  assert.equal(harness.audio.loop, true);
  assert.equal(harness.audio.playCalls, 1);

  harness.audio.pause();
  assert.equal(harness.pendingTimeouts(), 1);
  harness.runNextTimeout();

  assert.equal(harness.audio.playCalls, 2);
  assert.equal(harness.audio.paused, false);
});

test("reloads the soundtrack source after a media error", () => {
  const harness = createHarness();
  harness.audio.error = { code: 2 };
  harness.audio.dispatch("error");

  harness.runNextTimeout();

  assert.equal(harness.audio.loadCalls, 1);
  assert.equal(harness.audio.playCalls, 2);
  assert.equal(harness.audio.paused, false);
});

test("retries playback when the audio clock stops advancing", () => {
  const harness = createHarness();
  harness.advanceTime(30001);
  harness.runWatchdogs();

  assert.equal(harness.pendingTimeouts(), 1);
  harness.runNextTimeout();

  assert.equal(harness.audio.loadCalls, 1);
  assert.equal(harness.audio.paused, false);
});

test("keeps the soundtrack stopped when disabled", () => {
  const harness = createHarness();
  harness.audio.currentTime = 7;
  harness.storage.set("safenet-soundtrack-muted", "true");
  harness.window.dispatchEvent({ type: "safenet-soundtrack-change" });

  assert.equal(harness.audio.muted, true);
  assert.equal(harness.audio.paused, true);
  assert.equal(harness.audio.currentTime, 0);

  harness.audio.dispatch("error");
  harness.runWatchdogs();
  assert.equal(harness.pendingTimeouts(), 0);
  assert.equal(harness.audio.playCalls, 1);
});

test("uses the same controller for native pause and resume", () => {
  const harness = createHarness();
  const controller = harness.window.__safeNetSoundtrack as {
    suspend: () => void;
    resume: () => void;
  };

  controller.suspend();
  assert.equal(harness.audio.paused, true);
  assert.equal(harness.pendingTimeouts(), 0);

  controller.resume();
  assert.equal(harness.audio.paused, false);
  assert.equal(harness.audio.playCalls, 2);
});