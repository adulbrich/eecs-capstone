/**
 * Regenerates public/social-card.png. Run from the repo root with the repo's
 * node_modules on the resolution path, because `sharp` provides the renderer.
 *
 * The card is committed rather than generated at build time: og:image wants a
 * stable URL, and this text is rendered with host fonts, which a container
 * does not have.
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";

const W = 1200, H = 630, M = 90;
const ORANGE = "#D73F09", WHITE = "#FFFFFF";
const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";
const TITLE = "EECS Capstone";
const SUBTITLE = "School of Electrical Engineering and Computer Science";

const lockup = readFileSync("src/assets/logo-institution.svg", "utf8");
const reversed = await sharp(Buffer.from(lockup.replaceAll("#231f20", WHITE)))
  .resize({ width: 350 }).png().toBuffer();

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${ORANGE}"/>
  <rect x="${M}" y="288" width="180" height="5" fill="${WHITE}"/>
  <text x="${M}" y="452" font-family="${FONT}" font-size="112" font-weight="700" fill="${WHITE}">${TITLE}</text>
  <text x="${M}" y="514" font-family="${FONT}" font-size="32" fill="${WHITE}">${SUBTITLE}</text>
</svg>`;

await sharp(Buffer.from(svg))
  .composite([{ input: reversed, top: 100, left: M }])
  .png().toFile("public/social-card.png");
