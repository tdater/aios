import { useMemo } from "react";
import { RING_RADII, SealView, sealGeometry } from "../core/seal";

/** The Proof Seal. Decorative in shape, strictly factual in meaning: see core/seal.ts. */
export function ProofSeal({ hash, view, size = 64 }: { hash: string | null | undefined; view: SealView; size?: number }) {
  const g = useMemo(() => sealGeometry(hash), [hash]);
  return (
    <svg className={`seal ${view.state}`} viewBox="-50 -50 100 100" width={size} height={size} role="img" aria-label={view.label}>
      <title>{view.label}</title>
      <path className="edge" d={g.edge} />
      {view.checks.approved === true && <circle className="ring r-approved" r={RING_RADII.approved} />}
      {view.checks.tests === true && <circle className="ring r-tests" r={RING_RADII.tests} />}
      {view.checks.review === true && <circle className="ring r-review" r={RING_RADII.review} />}
      {g.dots.map((d, i) => <circle key={i} className="dot" cx={d.x} cy={d.y} r={1.9} />)}
      {view.state === "cracked" && <path className="crack" d={g.crack} />}
    </svg>
  );
}
