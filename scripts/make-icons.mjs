// Generates the PWA icons and favicon from the official DDS logo.
//   npm run icons                      → uses assets/dds-logo.png
//   npm run icons -- path/to/logo.png  → uses another source image
// The logo has navy lettering on a transparent background, so it is placed on cream with
// padding (maskable icons get extra padding so Android's circle/squircle crop doesn't clip it).
import sharp from "sharp";

const src = process.argv[2] ?? "assets/dds-logo.png";
const cream = { r: 247, g: 243, b: 234, alpha: 1 };
const out = "public/icons";

async function icon(size, file, padding, background = cream) {
  const inner = Math.round(size * (1 - padding * 2));
  const logo = await sharp(src)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(`${out}/${file}`);
  console.log(`${out}/${file}`);
}

await icon(192, "icon-192.png", 0.1);
await icon(512, "icon-512.png", 0.1);
await icon(512, "icon-maskable-512.png", 0.22);
await icon(180, "apple-touch-icon.png", 0.1);
await icon(64, "favicon-64.png", 0.04, { r: 0, g: 0, b: 0, alpha: 0 });
// Transparent logo for use inside the app (login screen, sidebar).
await sharp(src).resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(`${out}/logo-256.png`);
console.log(`${out}/logo-256.png`);
