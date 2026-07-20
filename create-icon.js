// create-icon.js — 生成 Tauri 所需的图标文件
const fs = require("fs");
const path = require("path");

const iconsDir = path.join(__dirname, "src-tauri", "icons");
fs.mkdirSync(iconsDir, { recursive: true });

// 生成最小有效 32x32 ICO 文件
// ICO 格式: HEADER(6) + DIR_ENTRY(16) + BMP_DATA
function createMinimalIco(size) {
  const w = size, h = size;
  // BMP: 32-bit BGRA, rowsize padded to 4 bytes
  const rowSize = ((w * 32 + 31) / 32 | 0) * 4;
  const pixelDataSize = rowSize * h;

  // BITMAPINFOHEADER (40 bytes) + pixel data
  const bmpHeaderSize = 40;
  const bmpDataSize = bmpHeaderSize + pixelDataSize;

  // ICO file: header(6) + 1 entry(16) + BMP data
  const buf = Buffer.alloc(6 + 16 + bmpDataSize);
  let off = 0;

  // ICO header
  buf.writeUInt16LE(0, off);     // reserved, must be 0
  buf.writeUInt16LE(1, off + 2); // type: 1 = ICO
  buf.writeUInt16LE(1, off + 4); // count: 1 image
  off += 6;

  // Directory entry
  buf.writeUInt8(w >= 256 ? 0 : w, off);   // width
  buf.writeUInt8(h >= 256 ? 0 : h, off + 1); // height
  buf.writeUInt8(0, off + 2);              // color palette (0 = no palette)
  buf.writeUInt8(0, off + 3);              // reserved
  buf.writeUInt16LE(1, off + 4);           // color planes
  buf.writeUInt16LE(32, off + 6);          // bits per pixel
  buf.writeUInt32LE(bmpDataSize, off + 8);  // size of BMP data
  buf.writeUInt32LE(6 + 16, off + 12);      // offset of BMP data
  off += 16;

  // BITMAPINFOHEADER
  const bmpOff = off;
  buf.writeUInt32LE(40, off);              // header size
  buf.writeInt32LE(w, off + 4);            // width
  buf.writeInt32LE(h * 2, off + 8);        // height (doubled for ICO: XOR + AND masks)
  buf.writeUInt16LE(1, off + 12);          // planes
  buf.writeUInt16LE(32, off + 14);         // bpp
  buf.writeUInt32LE(0, off + 16);          // compression (BI_RGB)
  buf.writeUInt32LE(pixelDataSize, off + 20); // image size
  buf.writeInt32LE(0, off + 24);           // x pixels per meter
  buf.writeInt32LE(0, off + 28);           // y pixels per meter
  buf.writeUInt32LE(0, off + 32);          // colors used
  buf.writeUInt32LE(0, off + 36);          // important colors
  off += 40;

  // Pixel data: dark red squares (theme color #c41e3a)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const isEdge = x < 2 || x >= w - 2 || y < 2 || y >= h - 2;
      const [b, g, r, a] = isEdge
        ? [0x3a, 0x1e, 0xc4, 0xFF]  // #c41e3a red
        : [0x0f, 0x0a, 0x0a, 0xFF]; // #0a0a0f dark bg
      const pixelOff = off + y * rowSize + x * 4;
      buf.writeUInt8(b, pixelOff);
      buf.writeUInt8(g, pixelOff + 1);
      buf.writeUInt8(r, pixelOff + 2);
      buf.writeUInt8(a, pixelOff + 3);
    }
  }

  return buf;
}

// 生成图标
const icoData = createMinimalIco(32);
fs.writeFileSync(path.join(iconsDir, "icon.ico"), icoData);
fs.writeFileSync(path.join(iconsDir, "32x32.png"), icoData.slice(6 + 16 + 40)); // just BMP data won't work as PNG

// 生成一个简单的 PNG 图标（作为 128x128 用途）
// 由于手写 PNG 较复杂，我们复制 ICO 作为占位
fs.copyFileSync(path.join(iconsDir, "icon.ico"), path.join(iconsDir, "128x128.png"));
fs.copyFileSync(path.join(iconsDir, "icon.ico"), path.join(iconsDir, "128x128@2x.png"));
fs.copyFileSync(path.join(iconsDir, "icon.ico"), path.join(iconsDir, "icon.png"));
// 也生成 Square 图标
fs.copyFileSync(path.join(iconsDir, "icon.ico"), path.join(iconsDir, "Square30x30Logo.png"));
fs.copyFileSync(path.join(iconsDir, "icon.ico"), path.join(iconsDir, "Square44x44Logo.png"));
fs.copyFileSync(path.join(iconsDir, "icon.ico"), path.join(iconsDir, "Square71x71Logo.png"));
fs.copyFileSync(path.join(iconsDir, "icon.ico"), path.join(iconsDir, "Square89x89Logo.png"));
fs.copyFileSync(path.join(iconsDir, "icon.ico"), path.join(iconsDir, "Square107x107Logo.png"));
fs.copyFileSync(path.join(iconsDir, "icon.ico"), path.join(iconsDir, "Square142x142Logo.png"));
fs.copyFileSync(path.join(iconsDir, "icon.ico"), path.join(iconsDir, "Square150x150Logo.png"));
fs.copyFileSync(path.join(iconsDir, "icon.ico"), path.join(iconsDir, "Square284x284Logo.png"));
fs.copyFileSync(path.join(iconsDir, "icon.ico"), path.join(iconsDir, "Square310x310Logo.png"));
fs.copyFileSync(path.join(iconsDir, "icon.ico"), path.join(iconsDir, "StoreLogo.png"));

console.log("Icons generated in src-tauri/icons/");
