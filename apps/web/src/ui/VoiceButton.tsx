import { useEffect, useState } from "react";
import { allowVoiceInput, stopAllVoice, voiceInputAllowed } from "../core/voice";
import { Icon } from "./icons";
import { Btn } from "./kit";
import { useVoiceInput } from "./useVoiceInput";

/** Microphone for dictation. Press once to talk, press again (or Escape) to stop. The first press explains where the audio goes and asks first. */
export function VoiceButton({ onText, onBegin, label = "Speak your request" }: { onText: (phrase: string) => void; onBegin?: () => void; label?: string }) {
  const v = useVoiceInput(onText);
  const [allowed, setAllowed] = useState(voiceInputAllowed);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!v.listening) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") stopAllVoice(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [v.listening]);
  if (!v.supported) return null;
  const press = () => { if (v.listening) v.stop(); else if (!allowed) setAsking(true); else { onBegin?.(); v.start(); } };
  return (
    <span className="voice">
      <button type="button" className={"icon-btn" + (v.listening ? " live" : "")} aria-pressed={v.listening} aria-label={v.listening ? "Stop listening" : label} title={v.listening ? "Stop listening (Esc)" : label} onClick={press}>
        <Icon name="mic" size={16} />
      </button>
      {v.listening && <span className="live-comms" role="status">Listening. Press Esc to stop.</span>}
      {v.problem && <span className="note warn" role="alert">{v.problem}</span>}
      {asking && !allowed && (
        <div className="note info" role="dialog" aria-label="Use voice input?">
          <p>Voice input uses your browser&apos;s speech service. In Chrome and Edge the audio is sent to the browser&apos;s maker to be turned into text. AIOS only listens while you have pressed the microphone, and never keeps the audio.</p>
          <div className="row">
            <Btn onClick={() => { allowVoiceInput(true); setAllowed(true); setAsking(false); onBegin?.(); v.start(); }}>Use voice input</Btn>
            <Btn kind="ghost" onClick={() => setAsking(false)}>Not now</Btn>
          </div>
        </div>)}
    </span>
  );
}
