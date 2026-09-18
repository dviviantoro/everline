// SVG port of the original radio.png PD-measurement symbol (a filled disc with
// five rounded signal bars). Built as markup rather than an <img> so the disc
// can be recolored per severity at render time — a PNG would need one file per color.
export function radioSvg(color: string, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">
  <circle cx="12" cy="12" r="11.25" fill="${color}" stroke="#1e293b" stroke-width="1.5"/>
  <g fill="#ffffff">
    <rect x="3.4" y="9.6" width="2.3" height="4.8" rx="1.15"/>
    <rect x="7.2" y="7.4" width="2.3" height="9.2" rx="1.15"/>
    <rect x="10.85" y="5.1" width="2.3" height="13.8" rx="1.15"/>
    <rect x="14.5" y="7.4" width="2.3" height="9.2" rx="1.15"/>
    <rect x="18.3" y="9.6" width="2.3" height="4.8" rx="1.15"/>
  </g>
</svg>`;
}
