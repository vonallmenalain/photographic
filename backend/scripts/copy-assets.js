// Copies non-TS assets into the dist folder after tsc.
// (The datastore is Cloud Firestore now, so there is no SQL schema to copy.)
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const copies = [];

for (const [from, to] of copies) {
  const src = path.join(root, from);
  const dest = path.join(root, to);
  if (!fs.existsSync(src)) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`copied ${from} -> ${to}`);
}
