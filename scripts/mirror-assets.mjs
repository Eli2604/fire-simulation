/**
 * Copies the Poly Haven models and photo textures the scenes use (CC0) into <dir>/ph/, with
 * ph/index.json listing them, so a page hosted where Poly Haven can't be reached (a sandboxed
 * page) still has its statues, candelabra, furniture and ground photos: render/assets.js looks
 * there first. Publish the ph/ folder next to the page.
 *
 *   node scripts/mirror-assets.mjs <dir>
 *
 * The ids are read from the sources: polyhaven: '...' in models, the scanned props' ids, the
 * photo textures' files (render/patterns.js).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(process.argv[2] ?? resolve(root, 'dist'), 'ph');
const src = (p) => readFileSync(resolve(root, p), 'utf8');
const all = (re, text) => [...text.matchAll(re)].map((m) => m[1]);

const models = new Set();
for (const f of readdirSync(resolve(root, 'src/models'))) if (f.endsWith('.js')) all(/polyhaven:\s*'([^']+)'/g, src(`src/models/${f}`)).forEach((id) => models.add(id));
all(/\bid:\s*'([^']+)'/g, src('src/models/scannedProp.js')).forEach((id) => models.add(id));
const textures = all(/file:\s*'([^']+)'/g, src('src/render/patterns.js'));

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
function put(rel, buf) {
  const p = resolve(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
  return buf.length;
}

let bytes = 0;
const done = { models: [], textures: [] };
for (const id of models) {
  try {
    const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
    const g = files.gltf['1k'].gltf;
    bytes += put(`${id}/${id}.gltf`, await get(g.url));
    for (const [rel, f] of Object.entries(g.include ?? {})) bytes += put(`${id}/${rel}`, await get(f.url));
    done.models.push(id);
    console.log('model', id);
  } catch (e) {
    console.warn('model', id, e.message);
  }
}
for (const id of textures) {
  try {
    for (const kind of ['diff', 'nor']) bytes += put(`tex/${id}_${kind}.jpg`, await get(`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${id}/${id}_${kind === 'diff' ? 'diff' : 'nor_gl'}_1k.jpg`));
    done.textures.push(id);
    console.log('texture', id);
  } catch (e) {
    console.warn('texture', id, e.message);
  }
}
writeFileSync(resolve(dir, 'index.json'), JSON.stringify(done, null, 1));
console.log(`${dir}: ${done.models.length} models, ${done.textures.length} textures, ${(bytes / 1e6).toFixed(1)} MB`);
