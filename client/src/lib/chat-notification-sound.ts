import type { ChatNotificationMode } from "./chat-notification-preference";

// Three rising bell-like notes, with enough spacing to avoid overlapping alerts.
export const CHAT_CHIME_SPACING_MS = 820;
const notes = [
  { frequency: 783.99, offset: 0, duration: 0.18, peak: 0.32 },
  { frequency: 987.77, offset: 0.21, duration: 0.18, peak: 0.32 },
  { frequency: 1318.51, offset: 0.42, duration: 0.30, peak: 0.30 },
] as const;

let chatAudioContext: AudioContext | null = null;
const playingVoices = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();
const playingClips = new Set<{ source: AudioBufferSourceNode; gain: GainNode }>();
let voiceBufferPromise: Promise<AudioBuffer> | null = null;
export const CHAT_VOICE_URL = "/audio/team-chat-message-voice-v1.mp3";

function getChatAudioContext() {
  if (typeof window === "undefined") return null;
  const Constructor = window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return null;
  chatAudioContext ??= new Constructor();
  return chatAudioContext;
}

export function activateChatAudio() {
  const context = getChatAudioContext();
  if (context?.state === "suspended") void context.resume().catch(() => undefined);
}

export function stopChatNotificationSounds() {
  for (const voice of playingVoices) {
    try { voice.oscillator.stop(); } catch { /* Already ended. */ }
    voice.oscillator.disconnect();
    voice.gain.disconnect();
  }
  playingVoices.clear();
  for (const clip of playingClips) {
    try { clip.source.stop(); } catch { /* Already ended. */ }
    clip.source.disconnect();
    clip.gain.disconnect();
  }
  playingClips.clear();
}

async function loadVoiceBuffer(context: AudioContext) {
  voiceBufferPromise ??= (async () => {
    const response = await fetch(CHAT_VOICE_URL);
    if (!response.ok) throw new Error("The voice notification recording could not be loaded.");
    return context.decodeAudioData(await response.arrayBuffer());
  })().catch(error => {
    voiceBufferPromise = null;
    throw error;
  });
  return voiceBufferPromise;
}

export async function preloadChatVoice() {
  const context = getChatAudioContext();
  if (!context) throw new Error("This browser does not support notification audio.");
  await loadVoiceBuffer(context);
}

/** Also used with OfflineAudioContext to verify the waveform without playing it. */
export function scheduleChatNotificationChime(context: BaseAudioContext) {
  const start = context.currentTime + 0.01;
  for (const note of notes) {
    const at = start + note.offset;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const voice = { oscillator, gain };
    // Triangle harmonics are clearer in office noise than the old quiet sine beep.
    // Peaks remain below 0.33, and notes never overlap, leaving clipping headroom.
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(note.frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(note.peak, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(note.peak * 0.8, at + note.duration * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + note.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    playingVoices.add(voice);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      playingVoices.delete(voice);
    };
    oscillator.start(at);
    oscillator.stop(at + note.duration + 0.005);
  }
}

export function playChatNotificationChime(shouldPlay: () => boolean) {
  const context = getChatAudioContext();
  if (!context) return;
  const play = () => {
    // Resume is asynchronous: mute/view/user state may have changed meanwhile.
    if (shouldPlay()) scheduleChatNotificationChime(context);
  };
  if (context.state === "suspended") {
    void context.resume().then(play).catch(() => undefined);
  } else {
    play();
  }
}

/** Returns actual playback spacing so queued voice clips cannot overlap. */
export async function playChatNotification(
  mode: ChatNotificationMode,
  shouldPlay: () => boolean,
  onError: (message: string) => void,
): Promise<number> {
  if (mode === "muted" || !shouldPlay()) return 0;
  try {
    const context = getChatAudioContext();
    if (!context) throw new Error("This browser does not support notification audio.");
    if (context.state === "suspended") await context.resume();
    if (!shouldPlay()) return 0;
    if (mode === "chime") {
      scheduleChatNotificationChime(context);
      return CHAT_CHIME_SPACING_MS;
    }
    const buffer = await loadVoiceBuffer(context);
    if (!shouldPlay()) return 0;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    // The original voice file is loudness-normalized with clipping headroom.
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(context.destination);
    const clip = { source, gain };
    playingClips.add(clip);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      playingClips.delete(clip);
    };
    source.start(context.currentTime + 0.01);
    return Math.ceil(buffer.duration * 1000) + 120;
  } catch (error) {
    if (shouldPlay()) onError(error instanceof Error ? error.message : "Notification audio could not be played.");
    return 0;
  }
}