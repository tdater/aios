import { useCallback, useEffect, useRef, useState } from "react";
import { Recognition, recognitionCtor, VOICE_STOP_EVENT } from "../core/voice";

/** Push-to-talk dictation. One phrase per press; `onText` gets the whole phrase so far (interim and final). Never starts by itself. */
export function useVoiceInput(onText: (phrase: string) => void) {
  const Ctor = recognitionCtor();
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  const stop = useCallback(() => { try { rec.current?.stop(); } catch { /* already stopped */ } setListening(false); }, []);
  const start = useCallback(() => {
    if (!Ctor || rec.current) return;
    setProblem(null);
    const r = new Ctor();
    r.continuous = false; r.interimResults = true; r.lang = navigator.language || "en-US";
    r.onresult = (e) => cb.current(Array.from(e.results).map((x) => x[0].transcript).join("").trim());
    r.onerror = (e) => setProblem(e.error === "not-allowed" || e.error === "service-not-allowed" ? "The microphone is blocked. Allow it in the browser's site settings." : e.error === "no-speech" ? "I did not hear anything." : "Voice input stopped: " + (e.error ?? "unknown problem"));
    r.onend = () => { rec.current = null; setListening(false); };
    rec.current = r;
    try { r.start(); setListening(true); } catch { rec.current = null; setProblem("Voice input could not start."); }
  }, [Ctor]);

  useEffect(() => {
    const halt = () => stop();
    window.addEventListener(VOICE_STOP_EVENT, halt);
    return () => { window.removeEventListener(VOICE_STOP_EVENT, halt); try { rec.current?.abort(); } catch { /* gone */ } rec.current = null; };
  }, [stop]);

  return { supported: !!Ctor, listening, problem, start, stop };
}
