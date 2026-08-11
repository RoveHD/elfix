const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "..", "build");
const source = path.join(outDir, "Elfix_Logo.png");
const out = path.join(outDir, "icon.ico");
const resizeScriptPath = path.join(outDir, "resize-icon.ps1");
const sizes = [16, 32, 48, 64, 128, 256];

if (!fs.existsSync(source)) {
  throw new Error(`Icon source missing: ${source}`);
}

fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(resizeScriptPath, `
param(
  [string]$Source,
  [string]$Target,
  [int]$Size
)
Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Image]::FromFile($Source)
try {
  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($image, 0, 0, $Size, $Size)
      $bitmap.Save($Target, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
    }
  } finally {
    $bitmap.Dispose()
  }
} finally {
  $image.Dispose()
}
`);

const generated = sizes.map((size) => {
  const target = path.join(outDir, `icon-${size}.png`);
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resizeScriptPath, source, target, String(size)], {
    stdio: "pipe"
  });
  return { size, png: fs.readFileSync(target) };
});

const headerSize = 6;
const entrySize = 16;
const imageOffset = headerSize + entrySize * generated.length;
const totalSize = imageOffset + generated.reduce((sum, item) => sum + item.png.length, 0);
const ico = Buffer.alloc(totalSize);

ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(generated.length, 4);

let offset = imageOffset;
generated.forEach((item, index) => {
  const entryOffset = headerSize + entrySize * index;
  ico[entryOffset] = item.size === 256 ? 0 : item.size;
  ico[entryOffset + 1] = item.size === 256 ? 0 : item.size;
  ico[entryOffset + 2] = 0;
  ico[entryOffset + 3] = 0;
  ico.writeUInt16LE(1, entryOffset + 4);
  ico.writeUInt16LE(32, entryOffset + 6);
  ico.writeUInt32LE(item.png.length, entryOffset + 8);
  ico.writeUInt32LE(offset, entryOffset + 12);
  item.png.copy(ico, offset);
  offset += item.png.length;
});

fs.writeFileSync(out, ico);
