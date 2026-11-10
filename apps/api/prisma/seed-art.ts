/**
 * Generated artwork for the demo data, so the seeded shop looks finished without shipping
 * stock photos. Real photos uploaded through the admin screens replace these.
 */

export type Vessel = 'jar' | 'bottle' | 'spray' | 'tube' | 'tin' | 'brush';

interface ProductArt {
  label: string;
  sub: string;
  vessel: Vessel;
  /** Background, vessel body, accent. */
  colors: [string, string, string];
}

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Arial, sans-serif";
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function vesselShape(v: Vessel, body: string, accent: string) {
  const label = (y: number, w: number, h: number) =>
    `<rect x="${300 - w / 2}" y="${y}" width="${w}" height="${h}" rx="3" fill="#f7f1e6"/>`;
  switch (v) {
    case 'jar':
      return {
        shape: `<rect x="176" y="330" width="248" height="52" rx="10" fill="${accent}"/>
          <rect x="168" y="372" width="264" height="188" rx="22" fill="${body}"/>
          ${label(410, 204, 112)}`,
        textY: 458,
      };
    case 'tin':
      return {
        shape: `<ellipse cx="300" cy="418" rx="150" ry="34" fill="${accent}"/>
          <rect x="150" y="418" width="300" height="118" fill="${body}"/>
          <ellipse cx="300" cy="536" rx="150" ry="34" fill="${body}"/>
          <ellipse cx="300" cy="418" rx="150" ry="34" fill="${accent}" opacity=".92"/>
          ${label(446, 190, 78)}`,
        textY: 480,
      };
    case 'spray':
      return {
        shape: `<rect x="270" y="150" width="60" height="34" rx="6" fill="${accent}"/>
          <rect x="284" y="184" width="32" height="40" fill="${accent}"/>
          <path d="M238 262c0-22 18-40 40-40h44c22 0 40 18 40 40v276c0 12-10 22-22 22H260c-12 0-22-10-22-22z" fill="${body}"/>
          ${label(320, 100, 170)}`,
        textY: 398,
      };
    case 'tube':
      return {
        shape: `<rect x="262" y="512" width="76" height="48" rx="8" fill="${accent}"/>
          <path d="M214 190h172l-22 322H236z" fill="${body}"/>
          <rect x="208" y="176" width="184" height="18" rx="4" fill="${accent}"/>
          ${label(270, 110, 150)}`,
        textY: 338,
      };
    case 'brush':
      return {
        shape: `<rect x="278" y="120" width="44" height="210" rx="22" fill="${accent}"/>
          <rect x="196" y="318" width="208" height="150" rx="40" fill="${body}"/>
          ${Array.from({ length: 9 }, (_, i) => `<rect x="${214 + i * 21}" y="468" width="8" height="74" rx="4" fill="#3b2f25" opacity=".85"/>`).join('')}
          ${label(356, 150, 70)}`,
        textY: 386,
      };
    default:
      return {
        shape: `<rect x="272" y="150" width="56" height="54" rx="8" fill="${accent}"/>
          <path d="M228 268c0-36 28-56 52-64h40c24 8 52 28 52 64v270c0 12-10 22-22 22H250c-12 0-22-10-22-22z" fill="${body}"/>
          ${label(330, 108, 160)}`,
        textY: 400,
      };
  }
}

export function productSvg({ label, sub, vessel, colors: [bg, body, accent] }: ProductArt) {
  const { shape, textY } = vesselShape(vessel, body, accent);
  const narrow = vessel === 'spray' || vessel === 'tube' || vessel === 'bottle';
  const words = label.toUpperCase().split(' ');
  const lines = narrow ? words : [words.join(' ')];
  const size = narrow ? 15 : 19;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 720" width="600" height="720">
  <defs>
    <radialGradient id="g" cx="50%" cy="38%" r="75%">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".9"/>
      <stop offset="1" stop-color="${bg}"/>
    </radialGradient>
  </defs>
  <rect width="600" height="720" fill="${bg}"/>
  <rect width="600" height="720" fill="url(#g)"/>
  <ellipse cx="300" cy="574" rx="190" ry="20" fill="#1b1612" opacity=".16"/>
  <g>${shape}</g>
  ${lines
    .map(
      (line, i) =>
        `<text x="300" y="${textY + i * (size + 5) - ((lines.length - 1) * (size + 5)) / 2}" text-anchor="middle" font-family="${SERIF}" font-size="${size}" letter-spacing="2.5" fill="#1b1612">${esc(line)}</text>`,
    )
    .join('\n  ')}
  <text x="300" y="${textY + (lines.length * (size + 5)) / 2 + 16}" text-anchor="middle" font-family="${SANS}" font-size="9" letter-spacing="3" fill="#6b5d4f">${esc(sub.toUpperCase())}</text>
  <text x="300" y="672" text-anchor="middle" font-family="${SANS}" font-size="10" letter-spacing="6" fill="#1b1612" opacity=".45">CHAIRTIME</text>
</svg>`;
}

/** An editorial monogram portrait: initials set large over a warm duotone field. */
export function portraitSvg(initials: string, [from, to, ink]: [string, string, string]) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 750" width="600" height="750">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
    <radialGradient id="glow" cx="30%" cy="20%" r="80%">
      <stop offset="0" stop-color="#fff" stop-opacity=".35"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <pattern id="stripes" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)">
      <rect width="14" height="28" fill="${ink}" opacity=".12"/>
    </pattern>
  </defs>
  <rect width="600" height="750" fill="url(#bg)"/>
  <rect width="600" height="750" fill="url(#glow)"/>
  <circle cx="300" cy="300" r="118" fill="${ink}" opacity=".9"/>
  <path d="M70 750c0-150 100-250 230-250s230 100 230 250z" fill="${ink}" opacity=".9"/>
  <rect y="560" width="600" height="190" fill="url(#stripes)"/>
  <text x="300" y="352" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="150" fill="${from}" opacity=".96">${initials}</text>
</svg>`;
}
