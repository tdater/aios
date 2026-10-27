/** A second opinion on a suspicious message, worked out on this computer from fixed rules. Nothing is sent anywhere.
 *  It looks for the habits scams share. It can say a message looks like a scam; it can never say a message is safe, so the
 *  best result is "no common signs found" with a reminder to check through an official channel. */

export interface Signal { id: string; label: string; weight: number }
export type Verdict = "scam" | "several" | "some" | "none";
export interface ScamResult { verdict: Verdict; headline: string; signals: Signal[]; links: string[]; steps: string[]; score: number }

const RULES: { id: string; label: string; weight: number; test: RegExp }[] = [
  { id: "urgent", label: "It pushes you to act right now or something bad will happen", weight: 2, test: /\b(act now|immediately|within (24|48) hours|urgent|final notice|last (chance|warning)|expires? (today|soon)|your account (will be|has been) (suspended|closed|locked|disabled)|avoid (suspension|penalt))/i },
  { id: "pay_odd", label: "It asks for payment in a way that is hard to undo (gift cards, wire, crypto, payment apps)", weight: 4, test: /\b(gift ?cards?|itunes card|google play card|wire transfer|western union|moneygram|bitcoin|crypto(currency)?|zelle|cash ?app|venmo|bank transfer)\b/i },
  { id: "credentials", label: "It asks for a password, one-time code, PIN or ID number", weight: 4, test: /\b(password|passcode|one[- ]time (code|passcode)|verification code|security code|pin( number)?|social security|ssn|card number|cvv|login details|confirm your (identity|account|details))\b/i },
  { id: "threat", label: "It threatens you (arrest, lawsuit, fines, losing benefits)", weight: 3, test: /\b(arrest(ed)?|warrant|lawsuit|legal action|police|irs|back taxes|fines?|deport|benefits? (will be|have been) (suspended|cancelled|stopped))\b/i },
  { id: "prize", label: "It says you have won something or are owed money", weight: 3, test: /\b(you('ve| have) won|winner|lottery|prize|claim your|refund (is )?(pending|waiting|available)|unclaimed|inheritance)\b/i },
  { id: "package", label: "It is about a package or delivery you did not ask about", weight: 2, test: /\b(package|parcel|delivery|shipment)\b.*\b(failed|held|fee|reschedule|unable to deliver|address (is )?(incorrect|incomplete))\b|\b(unable to deliver|redelivery fee|customs fee)\b/i },
  { id: "tech_support", label: "It claims to be tech support or says your device is infected", weight: 3, test: /\b(your (computer|device|pc) (is|has been) (infected|hacked|compromised)|virus detected|call (microsoft|apple) support|remote access)\b/i },
  { id: "phone", label: "It gives a phone number to call you back on", weight: 1, test: /\b(call|text|contact)\b[^.]{0,40}\b(\+?1?[ .-]?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4})\b/i },
  { id: "secrecy", label: "It tells you not to tell anyone or to keep it secret", weight: 3, test: /\b(do not|don't) (tell|share|discuss)|keep (this|it) (confidential|secret|between us)|do not hang up/i },
  { id: "generic", label: "It does not use your name (\"Dear customer\", \"Dear user\")", weight: 1, test: /\bdear (customer|user|client|member|account holder|sir\/madam|valued)\b/i },
];

const SHORTENERS = /(^|\.)(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|cutt\.ly|rb\.gy|shorturl\.at)$/i;
const BRANDS = ["paypal", "amazon", "apple", "microsoft", "netflix", "google", "chase", "wellsfargo", "bankofamerica", "usps", "fedex", "ups", "dhl", "irs", "venmo", "coinbase"];

/** Web addresses written in the message, trimmed of trailing punctuation. */
export function linksIn(text: string): string[] {
  return [...new Set((text.match(/\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi) ?? []).map((u) => u.replace(/[.,;:!?]+$/, "")))];
}

function hostOf(link: string): string | null {
  try { return new URL(/^https?:/i.test(link) ? link : `http://${link}`).hostname.toLowerCase(); } catch { return null; }
}

/** What is odd about a link, if anything: a bare IP address, a link shortener, a brand name on someone else's domain, or odd characters. */
export function linkWarning(link: string): string | null {
  const host = hostOf(link);
  if (!host) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return `${host} is a number, not a website name`;
  if (SHORTENERS.test(host)) return `${host} hides where the link really goes`;
  if (host.includes("xn--")) return `${host} uses look-alike characters`;
  const parts = host.split(".");
  const n = parts.length;
  const two = ["co", "com", "org", "gov", "ac", "net"].includes(parts[n - 2] ?? "") && (parts[n - 1] ?? "").length === 2;   // example.co.uk
  const own = parts[n - (two ? 3 : 2)] ?? "";                                                                                  // the name the site is registered under
  const tokens = host.split(/[.-]/);
  const squashed = host.replace(/[-.]/g, "");
  const deleet = squashed.replace(/0/g, "o").replace(/1/g, "l");
  for (const b of BRANDS) {
    if (own === b) continue;                                                                                                   // really theirs
    const hit = b.length <= 4 ? tokens.includes(b) || deleet.split(/[^a-z]+/).includes(b) : squashed.includes(b) || deleet.includes(b);
    if (hit) return `${host} mentions ${b} but is not ${b}'s own website`;
  }
  return null;
}

export function checkMessage(text: string): ScamResult {
  const t = text.trim();
  const signals: Signal[] = RULES.filter((r) => r.test.test(t)).map(({ id, label, weight }) => ({ id, label, weight }));
  const links = linksIn(t);
  for (const l of links) { const w = linkWarning(l); if (w) signals.push({ id: `link:${l}`, label: `A link looks wrong: ${w}`, weight: 3 }); }
  if (links.length && !signals.some((s) => s.id.startsWith("link:"))) signals.push({ id: "links", label: "It contains a link. Do not tap it; go to the company's website yourself", weight: 1 });
  const score = signals.reduce((n, s) => n + s.weight, 0);
  const verdict: Verdict = score >= 6 ? "scam" : score >= 3 ? "several" : score >= 1 ? "some" : "none";
  const headline = {
    scam: "This looks like a scam.",
    several: "This has several warning signs of a scam.",
    some: "This has a warning sign worth checking.",
    none: "No common scam signs found. That does not make it safe.",
  }[verdict];
  const steps = verdict === "none"
    ? ["If you were not expecting it, check with the company using a phone number or website you already know, not one from the message."]
    : ["Do not tap links, open attachments, or call numbers in the message.", "Do not send money, gift card codes, passwords or one-time codes.",
       "Contact the company using the website or phone number on your card, bill or its official app.", "If you already responded, tell your bank right away and change the password you used."];
  return { verdict, headline, signals, links, steps, score };
}
