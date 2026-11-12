/**
 * Builds the soldier rig test page (rig.html) as one self-contained HTML file: the page's code,
 * three.js and the sculpt worker (inlined, started from a blob) in a single document, to share
 * or host anywhere. Uses Rollup's API directly (no esbuild needed).
 *
 *   node scripts/build-rig-artifact.mjs [out.html] [page]   page: rig (default) or camp
 */
import { rollup } from 'rollup';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = process.argv[3] ?? 'rig';
const out = resolve(process.argv[2] ?? resolve(root, `dist/${page === 'rig' ? 'enemy-rig' : page}.html`));
const three = {
  name: 'resolve-three',
  resolveId(id) {
    if (id === 'three') return resolve(root, 'node_modules/three/build/three.module.js');
    if (id.startsWith('three/addons/')) return resolve(root, 'node_modules/three/examples/jsm', id.slice('three/addons/'.length));
    return null;
  },
};
async function bundle(input, plugins = []) {
  const b = await rollup({ input: resolve(root, input), plugins: [three, ...plugins], onwarn: () => {} });
  const { output } = await b.generate({ format: 'es', inlineDynamicImports: true });
  await b.close();
  return output[0].code;
}

const worker = await bundle('src/operator/sculpt.worker.js');
const inlineWorker = {
  name: 'inline-sculpt-worker',
  transform(code, id) {
    if (!id.replace(/\\/g, '/').endsWith('src/operator/rig.js')) return null;
    const from = "new Worker(new URL('./sculpt.worker.js', import.meta.url), { type: 'module' })";
    if (!code.includes(from)) throw new Error('worker construction not found in rig.js');
    const blob = `new Worker(URL.createObjectURL(new Blob([${JSON.stringify(worker)}], { type: 'text/javascript' })), { type: 'module' })`;
    return code.replace(from, blob);
  },
};
const code = (await bundle(`src/${page}/main.js`, [inlineWorker])).replace(/<\/script/gi, '<\\/script');
const html = readFileSync(resolve(root, `${page}.html`), 'utf8');
const head = html.slice(html.indexOf('<title>'), html.indexOf('</head>'));
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf(`<script type="module" src="./src/${page}/main.js"></script>`));
const doc = `${head}\n${body}\n<script type="module">\n${code}\n</script>\n`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, doc);
console.log(`${out}: ${(doc.length / 1e6).toFixed(2)} MB`);
