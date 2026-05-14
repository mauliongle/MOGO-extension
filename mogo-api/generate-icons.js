const fs   = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const MASTER_PNG = process.argv[2];
const ICONS_DIR  = process.argv[3] || path.join(__dirname, '..', 'mogo-extension', 'icons');
const SIZES = [16, 32, 48, 128];

async function main() {
  if (!MASTER_PNG || !fs.existsSync(MASTER_PNG)) {
    console.error('Error: master PNG not found at', MASTER_PNG);
    process.exit(1);
  }
  if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true });

  console.log('Loading master image from:', MASTER_PNG);
  const image = await Jimp.read(MASTER_PNG);
  console.log('Image loaded:', image.width, 'x', image.height);

  for (const size of SIZES) {
    const outPath = path.join(ICONS_DIR, `icon${size}.png`);
    const clone = image.clone();
    clone.resize({ w: size, h: size });
    await clone.write(outPath);
    console.log(`✅ icon${size}.png (${size}x${size})`);
  }
  console.log('\n🎉 All icons saved to:', ICONS_DIR);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
