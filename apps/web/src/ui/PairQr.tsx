import { useMemo } from "react";
import QRCode from "qrcode";

/** A QR code for a phone's camera. Drawn as an SVG from the code's own squares (nothing is injected as HTML, and nothing leaves this screen). */
export function PairQr({ link }: { link: string }) {
  const { size, path } = useMemo(() => {
    const q = QRCode.create(link, { errorCorrectionLevel: "M" });
    const n = q.modules.size, data = q.modules.data;
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (data[y * n + x]) d += `M${x} ${y}h1v1h-1z`;
    return { size: n, path: d };
  }, [link]);
  const quiet = 4;
  return (
    <svg className="pair-qr" role="img" aria-label="QR code: scan it with your phone's camera to open AIOS with the pairing code filled in" viewBox={`${-quiet} ${-quiet} ${size + quiet * 2} ${size + quiet * 2}`} width="240" height="240" shapeRendering="crispEdges">
      <rect x={-quiet} y={-quiet} width={size + quiet * 2} height={size + quiet * 2} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
