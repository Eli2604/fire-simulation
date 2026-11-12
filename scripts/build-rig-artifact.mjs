/**
 * Builds the soldier rig test page (rig.html) as one self-contained HTML file: the page's code,
 * three.js and the sculpt worker (inlined, started from a blob) in a single document, to share
 * or host anywhere. Uses Rollup's API directly (no esbuild needed).
 *
 *   node scripts/build-rig-artifact.mjs [out.html] [page]   page: rig (default), camp or main
 *
 * Built side by side (index.html from main, rig.html, camp.html, and models/skull.bin) the
 * pages link to each other: their scene lists switch between them.
 */
import { rollup } from 'rollup';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = process.argv[3] ?? 'rig';
const out = resolve(process.argv[2] ?? resolve(root, `dist/${page === 'main' ? 'index' : page}.html`));
const three = {
  name: 'resolve-three',
  resolveId(id) {
    if (id === 'three') return resolve(root, 'node_modules/three/build/three.module.js');
    if (id.startsWith('three/addons/')) return resolve(root, 'node_modules/three/examples/jsm', id.slice('three/addons/'.length));
    if (id.startsWith('three/')) return resolve(root, 'node_modules', id);
    // any other package (lil-gui): its ES module entry
    if (/^[a-z@]/i.test(id) && !/^[a-z]:/i.test(id)) return fileURLToPath(import.meta.resolve(id));
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
const entry = page === 'main' ? 'src/main.js' : `src/${page}/main.js`;
// SIM_PAGE=sim.html: where the scene lists find the simulation when it is not the folder's index
const simPage = process.env.SIM_PAGE;
const code = (await bundle(entry, [inlineWorker]))
  .replace(/<\/script/gi, '<\\/script')
  .replace(/'\.\/\?scenario='/g, simPage ? `'${simPage}?scenario='` : "'./?scenario='")
  // binary models fetched next to their module (render/models/*.bin): inlined as data URLs
  .replace(/new URL\('\.\/models\/([^']+)', import\.meta\.url\)/g, (_, f) => `'data:application/octet-stream;base64,${readFileSync(resolve(root, 'src/render/models', f)).toString('base64')}'`);
const html = readFileSync(resolve(root, page === 'main' ? 'index.html' : `${page}.html`), 'utf8');
// local stylesheets inline (remote ones, e.g. fonts, stay links)
const head = html
  .slice(html.indexOf('<title>'), html.indexOf('</head>'))
  .replace(/<link rel="stylesheet" href="\.\/([^"]+)"\s*\/?>/g, (_, p) => `<style>\n${readFileSync(resolve(root, p), 'utf8')}\n</style>`);
const tag = html.match(/<script type="module" src="[^"]+"><\/script>/)[0];
const bodyOpen = html.match(/<body[^>]*>/);
const body = html.slice(bodyOpen.index + bodyOpen[0].length, html.indexOf(tag));
const bodyAttrs = bodyOpen[0].slice(5, -1);
const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body${bodyAttrs}>
${body}
<script type="module">
${code}
</script>
</body>
</html>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, doc);
console.log(`${out}: ${(doc.length / 1e6).toFixed(2)} MB`);
