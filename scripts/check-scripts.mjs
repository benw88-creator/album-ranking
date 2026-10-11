import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let blocks = 0;
for (const file of fs.readdirSync(root).filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=|application\/(json|ld\+json)|text\/template/i.test(m[1]) || !m[2].trim()) continue;
    new vm.Script(m[2], { filename: `${file}:${html.slice(0, m.index).split('\n').length}` });
    blocks++;
  }
}
new vm.Script(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), { filename: 'sw.js' });
new vm.Script(fs.readFileSync(path.join(root, 'assets/interactions.js'), 'utf8'), { filename: 'assets/interactions.js' });
console.log(`Parsed ${blocks} inline scripts and service worker without errors.`);
