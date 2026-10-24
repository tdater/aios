import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "../ui/Markdown";
import { Block, countWords, inlineText, isSafeUrl, outline, parseInline, parseMarkdown } from "./markdown";

const blocks = (s: string) => parseMarkdown(s);
const kinds = (s: string) => blocks(s).map((b) => b.t);
const html = (s: string, extra = {}) => render(<Markdown source={s} {...extra} />).container;

describe("block structure", () => {
  it("headings get unique ids and feed the outline (also inside callouts)", () => {
    const b = blocks("# Intro\n\n## Setup\n\ntext\n\n## Setup\n\n> [!note] Box\n> ### Inside");
    expect(outline(b).map((o) => [o.level, o.id])).toEqual([[1, "intro"], [2, "setup"], [2, "setup-1"], [3, "inside"]]);
    expect(b[0]).toMatchObject({ t: "h", level: 1, text: "Intro" });
  });
  it("paragraphs, hard breaks, hr, and a hash without a space is not a heading", () => {
    expect(kinds("one\ntwo\n\nthree\n\n---\n\n#notheading")).toEqual(["p", "p", "hr", "p"]);
    expect(parseInline("a  \nb".replace(/ {2,}\n/g, "\n")).some((n) => n.t === "br")).toBe(true);
  });
  it("fenced code is literal (markdown, HTML and wiki links inside stay text); unclosed fences take the rest", () => {
    const b = blocks("```html\n<b>**not bold**</b> [[x]]\n```\nafter\n\n```\nunclosed # not a heading");
    expect(b[0]).toMatchObject({ t: "code", lang: "html", text: "<b>**not bold**</b> [[x]]" });
    expect(b[1]).toMatchObject({ t: "p" });
    expect(b[2]).toMatchObject({ t: "code", text: "unclosed # not a heading" });
  });
  it("lists: nested, ordered start, task items, list right after a paragraph", () => {
    const b = blocks("intro\n- a\n  - a1\n  - a2\n- b\n\n3. three\n4. four\n\n- [x] done\n- [ ] todo");
    expect(b.map((x) => x.t)).toEqual(["p", "list", "list", "list"]);
    const l0 = b[1] as Extract<Block, { t: "list" }>;
    expect(l0.items).toHaveLength(2);
    expect(l0.items[0].blocks.map((x) => x.t)).toEqual(["p", "list"]);
    expect((l0.items[0].blocks[1] as Extract<Block, { t: "list" }>).items).toHaveLength(2);
    expect(b[2]).toMatchObject({ ordered: true, start: 3 });
    expect((b[3] as Extract<Block, { t: "list" }>).items.map((i) => i.checked)).toEqual([true, false]);
  });
  it("callouts: types, aliases, custom/default titles, foldable markers", () => {
    const c = (s: string) => blocks(s)[0] as Extract<Block, { t: "callout" }>;
    expect(c("> [!tip] Keep it on\n> body")).toMatchObject({ kind: "tip", fold: null });
    expect(inlineText(c("> [!tip] Keep it on\n> body").title)).toBe("Keep it on");
    expect(inlineText(c("> [!warning]\n> x").title)).toBe("Warning");
    expect(c("> [!caution]- Folded\n> x")).toMatchObject({ kind: "warning", fold: "closed" });
    expect(c("> [!error]+ Open\n> x")).toMatchObject({ kind: "danger", fold: "open" });
    expect(c("> [!whatever] Unknown types are notes\n> x").kind).toBe("note");
    expect(kinds("> just a quote")).toEqual(["quote"]);
  });
  it("tables with alignment and escaped pipes", () => {
    const t = blocks("| A | B | C |\n|:--|:-:|--:|\n| 1 | 2 \\| 2 | 3 |")[0] as Extract<Block, { t: "table" }>;
    expect(t.align).toEqual(["left", "center", "right"]);
    expect(inlineText(t.rows[0][1])).toBe("2 | 2");
  });
  it("counts words without counting markup or code fences", () => {
    expect(countWords("# Title\n\n**bold** words here\n\n```\nignored code words\n```")).toBe(4);
  });
});

describe("inline syntax", () => {
  const types = (s: string) => parseInline(s).map((n) => n.t);
  it("emphasis variants; snake_case and math-like asterisks stay text", () => {
    expect(types("**b** *i* _i_ ~~d~~ ==m==")).toEqual(["strong", "text", "em", "text", "em", "text", "del", "text", "mark"]);
    expect(types("snake_case_name and 2 * 3 * 4")).toEqual(["text"]);
  });
  it("code spans, escapes, and autolinks", () => {
    expect(parseInline("`a*b*c` and \\*not italic\\*")).toEqual([{ t: "code", v: "a*b*c" }, { t: "text", v: " and *not italic*" }]);
    expect(types("see https://example.com/path.")).toEqual(["text", "link", "text"]);
  });
  it("wiki links in all spellings, #tags, and hex colours are not tags", () => {
    expect(parseInline("[[Gradle caching]]")).toEqual([{ t: "wiki", target: "Gradle caching" }]);
    expect(parseInline("[[Gradle caching|the cache]]")).toEqual([{ t: "wiki", target: "Gradle caching", alias: "the cache" }]);
    expect(parseInline("[[Gradle caching#Setup|alias]]")).toEqual([{ t: "wiki", target: "Gradle caching", alias: "alias", heading: "Setup" }]);
    expect(parseInline("tags #build/gradle and #Android").filter((n) => n.t === "tag")).toEqual([{ t: "tag", tag: "build/gradle" }, { t: "tag", tag: "android" }]);
    expect(parseInline("colour #ff00aa issue#12 #1234").some((n) => n.t === "tag")).toBe(false);
  });
});

describe("security: note text can never become markup, scripts, requests or unsafe links", () => {
  it("raw HTML is shown as text", () => {
    const c = html('<script>window.pwn=1</script><img src=x onerror="window.pwn=1"><iframe src=//evil></iframe> **ok**');
    expect(c.querySelector("script, img, iframe")).toBeNull();
    expect(c.textContent).toContain("<script>window.pwn=1</script>");
    expect(c.querySelector("strong")?.textContent).toBe("ok");
    expect((window as unknown as { pwn?: number }).pwn).toBeUndefined();
  });
  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///etc/passwd", "//evil.example/x", "/relative/path", "javascript&#58;alert(1)", "ja\tvascript:alert(1)"])(
    "unsafe link target %j is never an anchor", (url) => {
      const c = html(`[click me](${url})`);
      expect(c.querySelector("a")).toBeNull();
      expect(isSafeUrl(url)).toBe(false);
    });
  it("http(s) and mailto links are anchors that cannot reach window.opener", () => {
    const c = html("[a](https://ok.example/p?q=1) [m](mailto:a@b.co)");
    const links = [...c.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://ok.example/p?q=1", "mailto:a@b.co"]);
    expect(links.every((a) => a.rel.includes("noopener") && a.rel.includes("noreferrer") && a.target === "_blank")).toBe(true);
  });
  it("images are placeholders: a note can never make the app fetch anything", () => {
    const c = html("![tracker](https://tracker.example/pixel.png) ![](x)");
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelectorAll(".imgph")).toHaveLength(2);
  });
  it("wiki link text and tags are escaped; unknown wiki links render as ghost text", () => {
    const c = html("[[<b>x</b>]] #safe", { wiki: () => null });
    expect(c.querySelector("b")).toBeNull();
    expect(c.querySelector(".wikilink.ghost")?.textContent).toBe("<b>x</b>");
  });
  it("render hooks get called for wiki links and tags", () => {
    const opened: string[] = [];
    const c = html("[[Target|Alias]] #t", { wiki: (t: string) => <button className="wl" onClick={() => opened.push(t)}>go</button>, onTag: (t: string) => opened.push(`#${t}`) });
    (c.querySelector(".wl") as HTMLElement).click();
    (c.querySelector(".tagchip") as HTMLElement).click();
    expect(opened).toEqual(["Target", "#t"]);
  });
  it("hostile and pathological inputs finish quickly and never throw", () => {
    const inputs = ["*".repeat(60_000), "[".repeat(20_000), "`".repeat(20_000), "_ _ ".repeat(20_000), "> ".repeat(5_000) + "x", "- ".repeat(5_000) + "x",
      "|a|b|\n|-|-|\n".repeat(3_000), "[[".repeat(20_000), "#".repeat(5_000), "x".repeat(600_000), "(".repeat(30_000), "![a](".repeat(10_000)];
    for (const s of inputs) {
      const t = performance.now();
      expect(() => parseMarkdown(s)).not.toThrow();
      expect(performance.now() - t, `slow input starting ${JSON.stringify(s.slice(0, 12))}`).toBeLessThan(4000);
    }
  });
  it("very deep nesting is capped instead of overflowing the stack", () => {
    const deep = "> ".repeat(500) + "text";
    expect(() => parseMarkdown(deep)).not.toThrow();
    expect(() => render(<Markdown source={deep} />)).not.toThrow();
  });
});

describe("rendering", () => {
  it("renders a rich note: callout, table, tasks, code with language label", () => {
    const c = html("> [!tip] Keep it on\n> body\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n```properties\nk=v\n```");
    expect(c.querySelector(".callout.tip .ctitle")?.textContent).toContain("Keep it on");
    expect(c.querySelectorAll("th")).toHaveLength(2);
    expect((c.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    expect(c.querySelector("pre .lang")?.textContent).toBe("properties");
  });
  it("folded callouts are <details> and heading ids are prefixed to avoid clobbering page ids", () => {
    const c = html("> [!note]- Folded\n> hidden\n\n## Setup");
    expect(c.querySelector("details.callout")).not.toBeNull();
    expect(c.querySelector("h2")?.id).toBe("md-setup");
  });
});
