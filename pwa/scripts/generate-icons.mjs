// Generates the PWA icon set from one SVG source.
//
// Kept as a script rather than committed binaries so the mark can be changed in
// one place. Maskable variants carry the extra padding Android needs: without
// them the launcher crops a circle out of the icon and clips the mark.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public", "icons");

// Calm rather than institutional: a soft dusk gradient and a single steady
// mark. This is a wellbeing companion, not a badge of office.
const INK = "#0f2a3f";
const MID = "#1f5f7a";
const GLOW = "#7fd1c1";

/**
 * @param {number} size
 * @param {number} inset fraction of the canvas kept clear at the edges
 */
function svg(size, inset) {
  const c = size / 2;
  const r = (size / 2) * (1 - inset);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${MID}"/>
      <stop offset="100%" stop-color="${INK}"/>
    </linearGradient>
    <radialGradient id="orb" cx="50%" cy="42%" r="58%">
      <stop offset="0%" stop-color="${GLOW}" stop-opacity="0.95"/>
      <stop offset="60%" stop-color="${GLOW}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${GLOW}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)"/>
  <circle cx="${c}" cy="${c}" r="${r * 0.92}" fill="url(#orb)"/>
  <circle cx="${c}" cy="${c}" r="${r * 0.46}" fill="none"
          stroke="${GLOW}" stroke-width="${size * 0.035}" stroke-opacity="0.9"/>
  <circle cx="${c}" cy="${c}" r="${r * 0.16}" fill="${GLOW}"/>
</svg>`;
}

const targets = [
  // [filename, pixel size, edge inset]
  // A plain icon fills its canvas; a maskable one must survive a circular crop,
  // so it keeps ~20% clear at the edges (the safe zone in the spec).
  ["icon-192.png", 192, 0.06],
  ["icon-512.png", 512, 0.06],
  ["icon-192-maskable.png", 192, 0.22],
  ["icon-512-maskable.png", 512, 0.22],
  ["apple-touch-icon.png", 180, 0.06],
];

await mkdir(outDir, { recursive: true });

for (const [name, size, inset] of targets) {
  const png = await sharp(Buffer.from(svg(size, inset))).png().toBuffer();
  await writeFile(join(outDir, name), png);
  console.log(`${name.padEnd(24)} ${size}x${size}  ${png.length} bytes`);
}

// Kept alongside the PNGs so the source of the mark is inspectable.
await writeFile(join(outDir, "icon.svg"), svg(512, 0.06), "utf8");
console.log("icon.svg                 source");
