// create-icon.cjs — 生成 Tauri 所需的图标文件
const fs = require("fs");
const path = require("path");

const iconsDir = path.join(__dirname, "src-tauri", "icons");
fs.mkdirSync(iconsDir, { recursive: true });

// 生成最小有效 32x32 ICO 文件
function createMinimalIco(size) {
  const w = size, h = size;
  const rowSize = ((w * 32 + 31) / 32 | 0) * 4;
  const pixelDataSize = rowSize * h;
  const bmpDataSize = 40 + pixelDataSize;
  const buf = Buffer.alloc(6 + 16 + bmpDataSize);
  let off = 0;

  // ICO header
  buf.writeUInt16LE(0, off);
  buf.writeUInt16LE(1, off + 2);
  buf.writeUInt16LE(1, off + 4);
  off += 6;

  // Directory entry
  buf.writeUInt8(w >= 256 ? 0 : w, off);
  buf.writeUInt8(h >= 256 ? 0 : h, off + 1);
  buf.writeUInt8(0, off + 2);
  buf.writeUInt8(0, off + 3);
  buf.writeUInt16LE(1, off + 4);
  buf.writeUInt16LE(32, off + 6);
  buf.writeUInt32LE(bmpDataSize, off + 8);
  buf.writeUInt32LE(6 + 16, off + 12);
  off += 16;

  // BITMAPINFOHEADER
  buf.writeUInt32LE(40, off);
  buf.writeInt32LE(w, off + 4);
  buf.writeInt32LE(h * 2, off + 8);
  buf.writeUInt16LE(1, off + 12);
  buf.writeUInt16LE(32, off + 14);
  buf.writeUInt32LE(0, off + 16);
  buf.writeUInt32LE(pixelDataSize, off + 20);
  buf.writeInt32LE(0, off + 24);
  buf.writeInt32LE(0, off + 28);
  buf.writeUInt32LE(0, off + 32);
  buf.writeUInt32LE(0, off + 36);
  off += 40;

  // Pixel data: dark red border on dark bg
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const isEdge = x < 2 || x >= w - 2 || y < 2 || y >= h - 2;
      const [b, g, r, a] = isEdge
        ? [0x3a, 0x1e, 0xc4, 0xFF]
        : [0x0f, 0x0a, 0x0a, 0xFF];
      const pixelOff = off + y * rowSize + x * 4;
      buf.writeUInt8(b, pixelOff);
      buf.writeUInt8(g, pixelOff + 1);
      buf.writeUInt8(r, pixelOff + 2);
      buf.writeUInt8(a, pixelOff + 3);
    }
  }

  return buf;
}

const icoData = createMinimalIco(32);
fs.writeFileSync(path.join(iconsDir, "icon.ico"), icoData);

const pngs = [
  "32x32.png", "128x128.png", "128x128@2x.png", "icon.png",
  "Square30x30Logo.png", "Square44x44Logo.png", "Square71x71Logo.png",
  "Square89x89Logo.png", "Square107x107Logo.png", "Square142x142Logo.png",
  "Square150x150Logo.png", "Square284x284Logo.png", "Square310x310Logo.png",
  "StoreLogo.png",
];

for (const name of pngs) {
  fs.copyFileSync(path.join(iconsDir, "icon.ico"), path.join(iconsDir, name));
}

console.log("Icons generated in src-tauri/icons/");
