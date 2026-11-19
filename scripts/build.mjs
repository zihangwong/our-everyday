import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const html = await readFile(new URL('maincode', root), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('maincode is missing its inline script');
new vm.Script(script, { filename: 'maincode.inline.js' });
await writeFile(new URL('index.html', root), html);
console.log('index.html generated; inline JavaScript syntax verified.');
