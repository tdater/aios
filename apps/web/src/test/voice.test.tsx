import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanForSpeech, pickVoice, recognitionCtor, speak, stopAllVoice, VOICE_STOP_EVENT } from "../core/voice";
import { VoiceButton } from "../ui/VoiceButton";

class FakeRec {
  static last: FakeRec | null = null;
  continuous = false; interimResults = false; lang = ""; started = 0; stopped = 0;
  onresult: ((e: never) => void) | null = null; onend: (() => void) | null = null; onerror: ((e: { error?: string }) => void) | null = null;
  constructor() { FakeRec.last = this; }
  start() { this.started++; } stop() { this.stopped++; this.onend?.(); } abort() { this.stopped++; }
  say(...parts: string[]) { this.onresult?.({ results: parts.map((t) => [{ transcript: t }]) } as never); }
}
const w = window as unknown as Record<string, unknown>;

beforeEach(() => { FakeRec.last = null; localStorage.clear(); w.webkitSpeechRecognition = FakeRec; });
afterEach(() => { cleanup(); delete w.webkitSpeechRecognition; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("voice helpers", () => {
  it("turns markdown into something sayable", () => {
    expect(cleanForSpeech("## Hi\n- **bold** and `code`\n[site](https://x.example/a) https://y.example\n```js\nboom()\n```")).toBe("Hi bold and code site a link (a code sample)");
  });
  it("prefers natural English voices, then any English, then anything", () => {
    const v = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice;
    expect(pickVoice([v("Plain", "en-US"), v("Jenny Online (Natural)", "en-US"), v("Hans Natural", "de-DE")])!.name).toBe("Jenny Online (Natural)");
    expect(pickVoice([v("Hans", "de-DE"), v("Plain", "en-GB")])!.name).toBe("Plain");
    expect(pickVoice([v("Hans", "de-DE")])!.name).toBe("Hans");
    expect(pickVoice([])).toBeUndefined();
  });
  it("speaks through the local synthesiser, replaces earlier speech, and refuses empty text", () => {
    const synth = { cancel: vi.fn(), speak: vi.fn(), getVoices: () => [] };
    vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; constructor(t: string) { this.text = t; } });
    expect(speak("**Hello** there", undefined, { speechSynthesis: synth, dispatchEvent: vi.fn() } as never)).toBe(true);
    expect(synth.cancel).toHaveBeenCalled();
    expect(synth.speak.mock.calls[0][0].text).toBe("Hello there");
    expect(speak("   ", undefined, { speechSynthesis: synth, dispatchEvent: vi.fn() } as never)).toBe(false);
    expect(speak("hi", undefined, { dispatchEvent: vi.fn() } as never)).toBe(false);          // a device with no voices says nothing
  });
  it("stop silences speech and tells every listener", () => {
    const synth = { cancel: vi.fn() };
    const dispatchEvent = vi.fn();
    stopAllVoice({ speechSynthesis: synth, dispatchEvent } as never);
    expect(synth.cancel).toHaveBeenCalled();
    expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe(VOICE_STOP_EVENT);
  });
  it("finds the recogniser under either name", () => {
    expect(recognitionCtor({ webkitSpeechRecognition: FakeRec } as never)).toBe(FakeRec);
    expect(recognitionCtor({} as never)).toBeNull();
  });
});

describe("the microphone button", () => {
  it("is absent where the browser cannot recognise speech", () => {
    delete w.webkitSpeechRecognition;
    render(<VoiceButton onText={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("asks before first use, does not start listening until agreed, and remembers the answer", () => {
    const onText = vi.fn(), onBegin = vi.fn();
    render(<VoiceButton onText={onText} onBegin={onBegin} />);
    fireEvent.click(screen.getByRole("button", { name: "Speak your request" }));
    expect(screen.getByRole("dialog").textContent).toContain("speech service");
    expect(FakeRec.last).toBeNull();                                                 // nothing is listening yet
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(FakeRec.last).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Speak your request" }));
    fireEvent.click(screen.getByRole("button", { name: "Use voice input" }));
    expect(FakeRec.last!.started).toBe(1);
    expect(onBegin).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("aios.voice.input")).toBe("1");
  });
  it("shows a live badge while listening, passes the phrase on, and stops on the button, Escape or Stop-all", () => {
    localStorage.setItem("aios.voice.input", "1");
    const onText = vi.fn();
    render(<VoiceButton onText={onText} />);
    fireEvent.click(screen.getByRole("button", { name: "Speak your request" }));
    expect(screen.getByRole("status").textContent).toContain("Listening");
    act(() => FakeRec.last!.say("buy furnace ", "filters"));
    expect(onText).toHaveBeenLastCalledWith("buy furnace filters");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(FakeRec.last!.stopped).toBeGreaterThan(0);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Speak your request" }));
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => { window.dispatchEvent(new Event(VOICE_STOP_EVENT)); });
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("explains a blocked microphone in plain words", () => {
    localStorage.setItem("aios.voice.input", "1");
    render(<VoiceButton onText={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Speak your request" }));
    act(() => FakeRec.last!.onerror!({ error: "not-allowed" }));
    expect(screen.getByRole("alert").textContent).toContain("microphone is blocked");
  });
});
