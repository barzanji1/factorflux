import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_CHIME_SPACING_MS,
  playChatNotificationChime,
  playChatNotification,
  scheduleChatNotificationChime,
  stopChatNotificationSounds,
} from "./chat-notification-sound";

test("louder three-note chime, cancellation, and guards after asynchronous resume", async () => {
  const oscillators: any[] = [];
  const envelopes: number[][] = [];
  let resolveResume: () => void = () => {};
  let resolveDecode: (buffer: AudioBuffer) => void = () => {};
  const clips: any[] = [];
  const context = {
    currentTime: 12,
    state: "running",
    destination: {},
    resume: () => new Promise<void>(resolve => { resolveResume = resolve; }),
    decodeAudioData: () => new Promise<AudioBuffer>(resolve => { resolveDecode = resolve; }),
    createBufferSource: () => {
      const source = {
        buffer: null,
        started: false,
        stopped: false,
        connect() {},
        disconnect() {},
        start() { source.started = true; },
        stop() { source.stopped = true; },
      };
      clips.push(source);
      return source;
    },
    createOscillator: () => {
      const oscillator = {
        type: "",
        frequency: { setValueAtTime: (frequency: number) => { oscillator.hz = frequency; } },
        hz: 0,
        at: 0,
        end: 0,
        stops: 0,
        disconnected: false,
        connect() {},
        disconnect() { oscillator.disconnected = true; },
        start(at: number) { oscillator.at = at; },
        stop(at = 0) { oscillator.end = at; oscillator.stops++; },
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain: () => {
      const values: number[] = [];
      envelopes.push(values);
      return {
        gain: {
          setValueAtTime(value: number) { values.push(value); },
          exponentialRampToValueAtTime(value: number) { values.push(value); },
        },
        connect() {},
        disconnect() {},
      };
    },
  };
  const previousWindow = (globalThis as any).window;
  const previousFetch = globalThis.fetch;
  (globalThis as any).window = { AudioContext: function () { return context; } };
  try {
    scheduleChatNotificationChime(context as unknown as BaseAudioContext);
    assert.equal(oscillators.length, 3);
    assert(oscillators.every(voice => voice.type === "triangle"));
    assert(oscillators[0].hz < oscillators[1].hz && oscillators[1].hz < oscillators[2].hz);
    assert(envelopes.every(values => Math.max(...values) >= 0.30 && Math.max(...values) <= 0.32));
    assert(envelopes.every(values => Math.max(...values) > 8 * 0.035), "Much louder than old gain");
    assert(oscillators[1].at > oscillators[0].end && oscillators[2].at > oscillators[1].end);
    assert(CHAT_CHIME_SPACING_MS > (oscillators[2].end - 12) * 1000);
    stopChatNotificationSounds();
    assert(oscillators.every(voice => voice.stops === 2 && voice.disconnected));
    const count = oscillators.length;
    playChatNotificationChime(() => false);
    assert.equal(oscillators.length, count, "Muted/viewed/self guard suppresses playback");

    context.state = "suspended";
    let eligible = true;
    playChatNotificationChime(() => eligible);
    eligible = false;
    resolveResume();
    await Promise.resolve();
    assert.equal(oscillators.length, count, "Recheck guards after resume resolves");

    context.state = "running";
    playChatNotificationChime(() => true);
    assert.equal(oscillators.length, count + 3);
    const errors: string[] = [];
    globalThis.fetch = (async () => ({ ok: false })) as typeof fetch;
    await playChatNotification("voice", () => true, error => errors.push(error));
    assert.equal(errors.length, 1, "Voice load errors are explicit, not a silent fallback");
    globalThis.fetch = (async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) })) as typeof fetch;
    eligible = true;
    const pendingVoice = playChatNotification("voice", () => eligible, error => errors.push(error));
    await new Promise(resolve => setImmediate(resolve));
    eligible = false;
    resolveDecode({ duration: 1.2 } as AudioBuffer);
    assert.equal(await pendingVoice, 0);
    assert.equal(clips.length, 0, "Recheck guards after voice file decoding");
    const spacing = await playChatNotification("voice", () => true, error => errors.push(error));
    assert.equal(clips.length, 1);
    assert(clips[0].started);
    assert.equal(spacing, 1320, "Queue spacing includes entire voice clip");
    await playChatNotification("muted", () => true, error => errors.push(error));
    assert.equal(clips.length, 1, "Mute never starts voice or chime");
    stopChatNotificationSounds();
    assert(clips[0].stopped, "Mute cancels the active voice clip");
  } finally {
    stopChatNotificationSounds();
    (globalThis as any).window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});