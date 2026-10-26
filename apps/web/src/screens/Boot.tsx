import { useEffect, useState } from "react";
import { ApiError, NetworkError } from "../core/client";
import { checkServerUrl } from "../core/servers";
import { Btn, ErrorBox, Notice, useOnce } from "../ui/kit";

export function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className="boot"><h1>AIOS</h1><div className="card"><h2>{title}</h2>{children}</div></main>;
}

export function SetupServer({ allowDevLoopback, onAdd }: { allowDevLoopback: boolean; onAdd: (label: string, url: string) => void }) {
  const [label, setLabel] = useState("My AIOS");
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    const c = checkServerUrl(url, allowDevLoopback);
    if (!c.ok) return setErr(c.reason);
    if (c.url === "") return setErr("Enter the server address, e.g. https://my-pc.tailnet-name.ts.net");
    onAdd(label, c.url);
  };
  return (
    <Frame title="Connect to your AIOS server">
      <p>Enter the HTTPS address of your AIOS server (for example a private Tailscale address). The server never needs to be on the public internet.</p>
      <ErrorBox msg={err} />
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="field"><span>Name</span><input value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <label className="field"><span>Server address</span><input inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        <Btn type="submit">Continue</Btn>
      </form>
      <p className="muted small">Plain HTTP is refused. No credentials are ever put in this address.</p>
    </Frame>
  );
}

export function Pair({ serverLabel, deviceDefault, onPair, onSwitch }: { serverLabel: string; deviceDefault: string; onPair: (code: string, device: string) => Promise<void>; onSwitch: () => void }) {
  const [code, setCode] = useState("");
  const [device, setDevice] = useState(deviceDefault);
  const [err, setErr] = useState<string | null>(null);
  const go = useOnce(async () => {
    setErr(null);
    try {
      await onPair(code, device);
      if (location.hash.startsWith("#pair=")) history.replaceState(null, "", location.pathname + location.search);   // the code is spent: do not keep it in the address bar
    } catch (e) {
      setErr(e instanceof ApiError ? (e.code === "pairing_locked" ? "Too many wrong codes. Wait 15 minutes, then ask the desktop for a new code." : e.message)
        : e instanceof NetworkError ? "Could not reach the server." : (e as Error).message);
    }
  });
  const [linked, setLinked] = useState(false);
  useEffect(() => {
    // The desktop shortcut opens http://127.0.0.1:8765/#pair=ABCD-EFGH. It only FILLS the code: a page that links here
    // must not be able to spend failed attempts against the pairing lockout, so the person still presses Pair.
    const m = /^#pair=([A-Za-z0-9-]{8,12})$/.exec(location.hash);
    if (m) { setCode(m[1].toUpperCase()); setLinked(true); }
  }, []);
  return (
    <Frame title="Sign in to this device">
      <p>Server: <strong>{serverLabel}</strong></p>
      <p>On the computer running AIOS, double-click <strong>AIOS sign-in code</strong> on your desktop (or run <code>scripts\pair.ps1</code>, or choose “Pair another device” in Settings on a signed-in device) and type the one-time code here. Codes work once and expire after 10 minutes.</p>
      {linked && !err && <Notice tone="info">Your sign-in code was filled in for you. Press <strong>Pair</strong> to finish.</Notice>}
      <ErrorBox msg={err} />
      <form onSubmit={(e) => { e.preventDefault(); void go.run(); }}>
        <label className="field"><span>Pairing code</span><input value={code} autoCapitalize="characters" autoCorrect="off" autoComplete="one-time-code" placeholder="ABCD-EFGH" onChange={(e) => setCode(e.target.value.toUpperCase())} /></label>
        <label className="field"><span>This device’s name</span><input value={device} onChange={(e) => setDevice(e.target.value)} /></label>
        <Btn type="submit" busy={go.busy} disabled={code.replace(/[^A-Z0-9]/g, "").length < 8 || !device.trim()}>Pair</Btn>
      </form>
      <button className="link" onClick={onSwitch}>Use a different server</button>
    </Frame>
  );
}

export function Unreachable({ label, detail, onRetry, onSwitch }: { label: string; detail: string; onRetry: () => void; onSwitch: () => void }) {
  return (
    <Frame title="Server unreachable">
      <Notice tone="bad">Could not reach <strong>{label}</strong>. {detail}</Notice>
      <p className="muted small">Nothing is shown as current while the server cannot be reached. Local drafts remain on this device.</p>
      <div className="row"><Btn onClick={onRetry}>Retry</Btn><Btn kind="ghost" onClick={onSwitch}>Change server</Btn></div>
    </Frame>
  );
}

export function ServerChanged({ label, onConfirm, onCancel }: { label: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Frame title="This address is a different server">
      <Notice tone="bad">The server at <strong>{label}</strong> reports a different identity than the one you connected to before. It could be a restored backup, a new install, or something impersonating it.</Notice>
      <p>Cached data and drafts from the previous server will not be shown with this one. Continue only if you expected this.</p>
      <div className="row"><Btn kind="danger" onClick={onConfirm}>It’s expected — forget the old data and continue</Btn><Btn kind="ghost" onClick={onCancel}>Cancel</Btn></div>
    </Frame>
  );
}

export function Incompatible({ detail, onReload }: { detail: string; onReload: () => void }) {
  return (
    <Frame title="App and server versions don’t match">
      <Notice tone="warn">{detail}</Notice>
      <p>Reload to fetch the newest app files. If this is the Android app, install the latest build.</p>
      <Btn onClick={onReload}>Clear app cache and reload</Btn>
    </Frame>
  );
}
