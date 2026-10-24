# Remote access and authentication (mobile companion)

Status legend: **IMPLEMENTED+TESTED** / **DOCUMENTED, NOT EXECUTED HERE** / **PLANNED**.

## Principles
- The AIOS server stays bound to **loopback** (`127.0.0.1`). It never opens a public port by itself.
- Remote access = a **private network path + HTTPS in front of the loopback port + AIOS's own device login**.
  All three layers; none is optional.
- Nothing here installs software, changes Azure/firewall/router settings, or enables public sharing. Each step
  below is something *you* choose to run.

## Authentication (IMPLEMENTED+TESTED, pytest `tests/test_mobile_api.py` + e2e)
One user, many **device sessions**. There is no password to guess: you pair a device with a one-time code that
only the trusted desktop can produce.

1. On the AIOS machine: `scripts\pair.ps1` (or Settings → *Pair another device* on a signed-in device).
   Output e.g. `Pairing code: K7QM-X4TD` — 8 characters, **single use, expires in 10 minutes**, stored only as a hash.
2. On the new device enter the code. After 5 wrong attempts in 15 minutes pairing locks for 15 minutes
   (HTTP 429), even for a correct code.
3. The server creates a session (30-day absolute expiry, 14-day idle expiry). Only `sha256(token)` is stored.
4. Sessions can be listed and **revoked** from Settings (any device) and are revoked server-side on logout.
   Revocation takes effect on the next request.

### Browser / PWA (same-origin)
- Session = **HttpOnly, SameSite=Strict** cookie (`Secure` automatically when served over HTTPS or behind a
  proxy sending `X-Forwarded-Proto: https`). JavaScript cannot read it.
- **CSRF**: double-submit token (`aios_csrf` cookie echoed in `X-CSRF-Token`) required on every write, plus an
  `Origin` check against `Host`. Reads need neither.
- The browser app stores **no credential** in localStorage.

### Android app (native)
- The pairing response returns an opaque **bearer token once**. The app stores it with
  `@aparajita/capacitor-secure-storage`: AES-GCM with a key held in the **Android Keystore**, saved in the app's
  private SharedPreferences. It is excluded from backup and device transfer.
- Every call sends `Authorization: Bearer …`; no cookies are used, so CSRF does not apply.
- CORS: the WebView origin (`https://localhost`) is allowed with **no credentials**
  (`AIOS_CORS_ORIGINS`, default `https://localhost,capacitor://localhost,http://localhost`).
- Token lost/stolen device: revoke the session from another device or delete it directly in the database; there
  is nothing to rotate on the phone.
- Verified in an Android emulator, see `docs/mobile-handoff.md`. **Not verified on a physical phone.**

## Network options
| Option | State | Notes |
|---|---|---|
| **Tailscale Serve** (recommended) | Tailscale 1.104.1 is installed on this PC but reported *"Unable to connect to the Tailscale coordination server"* when checked. **Not configured, not tested.** | tailnet-only HTTPS |
| Same Wi-Fi, no TLS | **Not supported** | the app refuses `http://` server addresses |
| Public internet / Funnel / port forwarding | **Do not** | `tailscale funnel` publishes to the internet; this guide never uses it |

### Setting up Tailscale Serve (you run these; I did not)
Prerequisites in the Tailscale admin console: **MagicDNS** and **HTTPS Certificates** enabled; this PC and the phone
signed in to the same tailnet; the Tailscale client healthy (`tailscale status` shows peers, not a coordination error).

```powershell
# 1. Tell AIOS which host name it may answer to (DNS-rebinding protection). Use YOUR name from `tailscale status`.
$env:AIOS_ALLOWED_HOSTS = "my-pc.my-tailnet.ts.net"
scripts\start.ps1
# 2. Publish the loopback port to your tailnet only, with a real certificate:
tailscale serve --bg 8765
tailscale serve status        # confirm it says "(tailnet only)", NOT "Funnel on"
```
Then in the Android app enter `https://my-pc.my-tailnet.ts.net` and pair. To stop sharing: `tailscale serve reset`.

Least-privilege network policy (recommended, in the Tailscale ACL): allow only your phone's tag/user to reach this
PC on port 443; deny the rest of the tailnet.

## Server settings reference
| Env var | Default | Purpose |
|---|---|---|
| `AIOS_HOST` | `127.0.0.1` | must stay loopback; startup refuses anything else |
| `AIOS_ALLOWED_HOSTS` | *(empty)* | extra `Host` names accepted (e.g. the Tailscale name) |
| `AIOS_CORS_ORIGINS` | `https://localhost,capacitor://localhost,http://localhost` | origins allowed for bearer-token calls |
| `AIOS_APPROVAL_TTL_S` | `86400` | how long an approval request stays valid |

## TLS rules
The app never disables certificate verification and the Android release build forbids all cleartext
(`usesCleartextTraffic=false`, network security config, `allowMixedContent=false`). A **debug-only** override allows
cleartext to `localhost`/`127.0.0.1` so an emulator can reach a dev server through `adb reverse`; it is not present
in release builds (a static test asserts this).

## What is NOT covered
- No push notifications; no background polling (see `docs/mobile-handoff.md`).
- No mTLS / hardware-attested devices. A paired device with a valid token is trusted until revoked.
- Real-device and real-Tailscale behaviour are untested here.
