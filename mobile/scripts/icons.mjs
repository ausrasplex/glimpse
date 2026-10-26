// Makes the Android launcher icons from Glimpse's own artwork (../public/glimpse-icon.svg's design).
// Run after changing the artwork: `node scripts/icons.mjs`. The PNGs are committed, so builds don't need this.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

// The renderer the server already uses for text on mashes.
const require = createRequire(new URL("../../package.json", import.meta.url));
const { initWasm, Resvg } = require("@resvg/resvg-wasm");
await initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));

const BG = "#1C1B19";
// The three cards and the play mark, without the tile behind them.
const CARDS = `
  <rect x="31" y="21" width="38" height="56" rx="9" fill="#5BA3A0" transform="rotate(-16 50 82)"/>
  <rect x="31" y="21" width="38" height="56" rx="9" fill="#9B87D6" transform="rotate(16 50 82)"/>
  <rect x="29.5" y="19.5" width="41" height="59" rx="10.5" fill="${BG}"/>
  <rect x="31" y="21" width="38" height="56" rx="9" fill="#E8A33D"/>
  <polygon points="44,40 44,58 58,49" fill="#141413" stroke="#141413" stroke-width="2.5" stroke-linejoin="round"/>`;

// Adaptive icon foreground: 108 units, artwork kept inside the 66-unit circle every launcher mask shows.
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><g transform="translate(19 20.3) scale(0.7)">${CARDS}</g></svg>`;
// Older Android (before 8.0): a finished square tile and a round one.
const square = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="23" fill="${BG}"/><g transform="translate(9 8) scale(0.82)">${CARDS}</g></svg>`;
const round = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="${BG}"/><g transform="translate(14 13.5) scale(0.72)">${CARDS}</g></svg>`;

const png = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
const res = "android/app/src/main/res/";
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITIES)) {
  writeFileSync(res + "mipmap-" + d + "/ic_launcher_foreground.png", png(foreground, Math.round(108 * k)));
  writeFileSync(res + "mipmap-" + d + "/ic_launcher.png", png(square, Math.round(48 * k)));
  writeFileSync(res + "mipmap-" + d + "/ic_launcher_round.png", png(round, Math.round(48 * k)));
}
writeFileSync(res + "values/ic_launcher_background.xml", `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BG}</color>
</resources>
`);
// A preview of all three, for checking by eye.
writeFileSync("scripts/icons-preview.png", png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 120"><rect width="360" height="120" fill="#EEE"/>
  <g transform="translate(6 6)"><clipPath id="c"><circle cx="54" cy="54" r="36"/></clipPath><rect width="108" height="108" fill="${BG}" clip-path="url(#c)"/><g clip-path="url(#c)">${foreground.replace(/<\/?svg[^>]*>/g, "")}</g><circle cx="54" cy="54" r="33" fill="none" stroke="#f00" stroke-width="0.4"/></g>
  <g transform="translate(130 10)">${square.replace(/<svg[^>]*>|<\/svg>/g, "")}</g>
  <g transform="translate(250 10)">${round.replace(/<svg[^>]*>|<\/svg>/g, "")}</g></svg>`, 1080));
console.log("Icons written");
