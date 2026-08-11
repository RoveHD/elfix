const fs = require("fs");
const path = require("path");

const roots = [
  path.join(__dirname, "..", "src"),
  path.join(__dirname, "..", "shared")
];
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (/\.(js|css|html)$/.test(entry.name)) {
      files.push(full);
    }
  }
}

for (const root of roots) {
  walk(root);
}

let failed = false;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  if (/\t/.test(text)) {
    console.error(`${file}: tabs are not allowed`);
    failed = true;
  }
  if (/[ \t]+$/m.test(text)) {
    console.error(`${file}: trailing whitespace`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(`lint ok (${files.length} files)`);
