/** Voice helpers. Speaking is local (the browser's own voices). Listening uses the browser's speech recogniser, which in Chrome and Edge sends
 *  the audio to the browser maker's speech service, so it is off until the owner turns it on and the screen says so. Nothing here listens in the
 *  background: recognition starts only from a button press and stops after one phrase, on Stop, on Escape, or when the page is left. */

export const VOICE_STOP_EVENT = "aios:voice-stop";
const PREF_KEY = "aios.voice.input";

type Win = Pick<Window, "dispatchEvent"> & Partial<Pick<Window, "speechSynthesis">> & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };

export interface Recognition {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
}
export type RecognitionCtor = new () => Recognition;

export function recognitionCtor(win: Win = window as unknown as Win): RecognitionCtor | null {
  return ((win.SpeechRecognition ?? win.webkitSpeechRecognition) as RecognitionCtor | undefined) ?? null;
}

/** Whether the owner has agreed to use the browser's speech service for listening. Per-device convenience, so a blocked store means "not yet". */
export function voiceInputAllowed(): boolean { try { return localStorage.getItem(PREF_KEY) === "1"; } catch { return false; } }
export function allowVoiceInput(on: boolean): void { try { if (on) localStorage.setItem(PREF_KEY, "1"); else localStorage.removeItem(PREF_KEY); } catch { /* stays off */ } }

/** Plain text for the speaker: no markdown marks, links shown as their words, long runs of blank space collapsed. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " (a code sample) ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " a link ")
    .replace(/^[#>\-*\s]+/gm, "")
    .replace(/[*_`~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefers the natural or neural voices Windows and Edge ship, then any English voice, then whatever exists. */
export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const lang = (v: SpeechSynthesisVoice) => v.lang?.toLowerCase().startsWith("en");
  return voices.find((v) => /natural|neural/i.test(v.name) && lang(v)) ?? voices.find(lang) ?? voices[0];
}

export function canSpeak(win: Pick<Window, "speechSynthesis"> | Win = window): boolean {
  return !!(win as Win).speechSynthesis && typeof SpeechSynthesisUtterance !== "undefined";
}

/** Reads text aloud, replacing anything already being said. Returns false when this device cannot speak or there is nothing to say. */
export function speak(text: string, onEnd?: () => void, win: Win = window as unknown as Win): boolean {
  const synth = win.speechSynthesis;
  const clean = cleanForSpeech(text).slice(0, 6000);
  if (!synth || typeof SpeechSynthesisUtterance === "undefined" || !clean) return false;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  const v = pickVoice(synth.getVoices());
  if (v) u.voice = v;
  if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }
  synth.speak(u);
  return true;
}

/** Stops speech and any listening, everywhere. Wired to Escape and to the Stop buttons. */
export function stopAllVoice(win: Win = window as unknown as Win): void {
  try { win.speechSynthesis?.cancel(); } catch { /* nothing to stop */ }
  win.dispatchEvent(new Event(VOICE_STOP_EVENT));
}
