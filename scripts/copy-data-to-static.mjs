import fs from 'fs';
import path from 'path';

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const srcDir = path.join(projectRoot, 'work', 'data');
const dstDir = path.join(projectRoot, 'static', 'data');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const copyFile = (src, dst) => {
  fs.copyFileSync(src, dst);
  console.log(`[copy-data] ${src} -> ${dst}`);
};

const main = () => {
  if (!fs.existsSync(srcDir)) {
    console.log(`[copy-data] Source not found, skipping: ${srcDir}`);
    return;
  }
  ensureDir(dstDir);
  const files = fs.readdirSync(srcDir);
  for (const f of files) {
    const src = path.join(srcDir, f);
    const dst = path.join(dstDir, f);
    const st = fs.statSync(src);
    if (st.isFile()) copyFile(src, dst);
  }
};

main();


