import { ReactNode, useMemo } from "react";
import { Block, Inline, parseMarkdown } from "../core/markdown";
import { Icon, IconName } from "./icons";

/** Renders the safe markdown AST as React nodes. There is no raw-HTML path anywhere: everything is a text node or a known element. */
export interface MarkdownProps {
  source: string;
  /** Render a [[wiki link]]. Receives the parsed target; return null to fall back to plain text. */
  wiki?: (target: string, alias: string | undefined, heading: string | undefined) => ReactNode;
  onTag?: (tag: string) => void;
  onExternal?: (url: string) => void;
}

const CALLOUT_ICON: Record<string, IconName> = { note: "info", info: "info", tip: "check", success: "check", warning: "alert", danger: "alert", bug: "alert", question: "help", quote: "list" };

function Inl({ nodes, p }: { nodes: Inline[]; p: MarkdownProps }) {
  return <>{nodes.map((n, i) => <One key={i} n={n} p={p} />)}</>;
}
function One({ n, p }: { n: Inline; p: MarkdownProps }): ReactNode {
  switch (n.t) {
    case "text": return n.v;
    case "br": return <br />;
    case "code": return <code>{n.v}</code>;
    case "strong": return <strong><Inl nodes={n.c} p={p} /></strong>;
    case "em": return <em><Inl nodes={n.c} p={p} /></em>;
    case "del": return <del><Inl nodes={n.c} p={p} /></del>;
    case "mark": return <mark><Inl nodes={n.c} p={p} /></mark>;
    case "link":
      return <a className="ext" href={n.href} target="_blank" rel="noopener noreferrer nofollow"
        onClick={p.onExternal ? (e) => { e.preventDefault(); p.onExternal!(n.href); } : undefined}><Inl nodes={n.c} p={p} /></a>;
    case "blocked": return <span className="blockedlink" title={n.why}><Inl nodes={n.c} p={p} /></span>;
    case "img": return <span className="imgph" title="Images are not loaded (privacy)">🖼 {n.alt || "image"}</span>;
    case "tag":
      return <button className="tagchip" onClick={() => p.onTag?.(n.tag)} type="button">#{n.tag}</button>;
    case "wiki": {
      const r = p.wiki?.(n.target, n.alias, n.heading);
      return r ?? <span className="wikilink ghost">{n.alias ?? n.target}</span>;
    }
  }
}

function Blk({ b, p }: { b: Block; p: MarkdownProps }): ReactNode {
  switch (b.t) {
    case "p": return <p><Inl nodes={b.c} p={p} /></p>;
    case "hr": return <hr />;
    case "h": {
      const H = (`h${b.level}`) as "h1";
      return <H id={`md-${b.id}`}><Inl nodes={b.c} p={p} /></H>;
    }
    case "code": return <pre tabIndex={0}>{b.lang && <span className="lang">{b.lang}</span>}<code>{b.text}</code></pre>;
    case "quote": return <blockquote><Blocks blocks={b.blocks} p={p} /></blockquote>;
    case "callout": {
      const icon = CALLOUT_ICON[b.kind] ?? "info";
      const title = <><Icon name={icon} size={16} /><span><Inl nodes={b.title} p={p} /></span></>;
      return b.fold
        ? <details className={`callout ${b.kind}`} open={b.fold === "open"}><summary>{title}</summary><div className="cbody"><Blocks blocks={b.blocks} p={p} /></div></details>
        : <div className={`callout ${b.kind}`} role="note"><div className="ctitle">{title}</div>{b.blocks.length > 0 && <div className="cbody"><Blocks blocks={b.blocks} p={p} /></div>}</div>;
    }
    case "list": {
      const L = b.ordered ? "ol" : "ul";
      return (
        <L className={b.tasks ? "tasks" : undefined} {...(b.ordered && b.start !== 1 ? { start: b.start } : {})}>
          {b.items.map((it, i) => (
            <li key={i} className={it.checked !== null ? "task" : undefined}>
              {it.checked !== null && <input type="checkbox" checked={it.checked} readOnly disabled aria-label={it.checked ? "done" : "not done"} />}
              <div><Blocks blocks={it.blocks} p={p} tight /></div>
            </li>
          ))}
        </L>
      );
    }
    case "table":
      return (
        <table>
          <thead><tr>{b.head.map((c, i) => <th key={i} style={{ textAlign: b.align[i] ?? undefined }}><Inl nodes={c} p={p} /></th>)}</tr></thead>
          <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, i) => <td key={i} style={{ textAlign: b.align[i] ?? undefined }}><Inl nodes={c} p={p} /></td>)}</tr>)}</tbody>
        </table>
      );
  }
}

function Blocks({ blocks, p, tight }: { blocks: Block[]; p: MarkdownProps; tight?: boolean }) {
  return <>{blocks.map((b, i) => (tight && b.t === "p" ? <span key={i} style={{ display: "block" }}><Inl nodes={b.c} p={p} /></span> : <Blk key={i} b={b} p={p} />))}</>;
}

export function Markdown(p: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(p.source), [p.source]);
  return <div className="md"><Blocks blocks={blocks} p={p} /></div>;
}
