import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import QRCode from "qrcode";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Settings } from "../screens/Settings";
import { PairQr } from "../ui/PairQr";
import { fakeServer } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

beforeEach(() => { resetRoute(""); setWidth(1200, 900); });
afterEach(() => cleanup());

const LINK = "https://yoga2in1.tail8c1f7a.ts.net/#pair=K7QM-X4TD";

describe("the QR code", () => {
  it("draws the real code for the link: same size and same squares as the library's own matrix", () => {
    const { container } = render(<PairQr link={LINK} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-label")).toContain("scan it with your phone's camera");
    const q = QRCode.create(LINK, { errorCorrectionLevel: "M" });
    const squares = (svg.querySelector("path")!.getAttribute("d")!.match(/M/g) ?? []).length;
    expect(squares).toBe(Array.from(q.modules.data).filter(Boolean).length);
    expect(svg.getAttribute("viewBox")).toBe(`-4 -4 ${q.modules.size + 8} ${q.modules.size + 8}`);
    expect(svg.querySelector("script, foreignObject")).toBeNull();                      // drawn from squares only, nothing injected
  });
  it("the link inside it is one the app's pairing screen understands: it only fills the code in", () => {
    const m = /^#pair=([A-Za-z0-9-]{8,12})$/.exec(new URL(LINK).hash);
    expect(m?.[1]).toBe("K7QM-X4TD");
  });
});

describe("Settings: pair a phone", () => {
  const open = (links: string[] | undefined) => {
    fakeServer({
      "GET /auth/sessions": () => ({ body: { items: [] } }),
      "POST /auth/pairing-codes": () => ({ status: 201, body: { code: "K7QM-X4TD", expires_at: "2026-10-28T12:10:00+00:00", ...(links ? { links } : {}) } }),
    } as never);
    render(<Wrap ctx={ctxFor().ctx}><Settings /></Wrap>);
  };

  it("shows a QR code with three plain steps when the PC has a secure address", async () => {
    open([LINK]);
    fireEvent.click(await screen.findByRole("button", { name: "Pair another device" }));
    const box = within(await screen.findByLabelText("Pair a phone with a QR code"));
    expect(box.getByRole("img", { name: /scan it with your phone's camera/ })).toBeTruthy();
    expect(box.getByText(/point it at this code/)).toBeTruthy();
    expect(box.getByText("https://yoga2in1.tail8c1f7a.ts.net/")).toBeTruthy();            // the address, never the code, is shown in text
    expect(screen.getByText("K7QM-X4TD")).toBeTruthy();                                   // the typed code is still offered
  });

  it("without a secure address it says how to get one instead of showing a useless code", async () => {
    open([]);
    fireEvent.click(await screen.findByRole("button", { name: "Pair another device" }));
    await waitFor(() => expect(screen.getByText(/first run/)).toBeTruthy());
    expect(screen.getByText(/phone-access\.ps1/)).toBeTruthy();
    expect(screen.queryByLabelText("Pair a phone with a QR code")).toBeNull();
  });
});
