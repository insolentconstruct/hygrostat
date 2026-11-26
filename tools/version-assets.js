// Copyright 2026 Insolent Construct.
// Author: Insolent Construct.
// MIT licence: see ../static/js/encoder.js.
// Run after editing the manifest or browser modules. The version binds both.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const root = new URL('../static/', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const list = (dir, suffix) => readdirSync(new URL(dir, root)).filter((p) => p.endsWith(suffix)).sort();
const clean = (s) => s.replace(/\?v=[a-f0-9]+/g, '');

// Pinned catalogue blobs and the region, each fetched under its own hash.
const contentAssets = ({ content }) => content ?
  [...content.models ?? [], ...content.libraries ?? [], content.rings, content.region].filter(Boolean) : [];
// The manifest without versions: what the asset version is computed from.
export function cleanManifest(manifest) {
  delete manifest.asset_version;
  for (const release of manifest.releases) {
    release.app = clean(release.app);
    if (release.combo) release.combo.bootloader = clean(release.combo.bootloader);
    for (const asset of contentAssets(release)) asset.url = clean(asset.url);
  }
  return manifest;
}
// Binaries carry their own hash, so an unchanged file stays cached across page versions.
export function versionManifest(manifest, version) {
  manifest.asset_version = version;
  for (const release of manifest.releases) {
    release.app += '?v=' + release.app_sha256;
    if (release.combo) release.combo.bootloader += '?v=' + release.combo.bootloader_sha256;
    for (const asset of contentAssets(release)) asset.url += '?v=' + asset.sha256;
  }
  return manifest;
}

function main() {
  const manifest = cleanManifest(JSON.parse(read('manifest.json')));
  const starterHash = createHash('sha256').update(read('starter-banks.json')).digest('hex');
  writeFileSync(new URL('js/starter_banks.js', root), read('js/starter_banks.js')
      .replace(/export const starterBanksHash = '[^']*';/, `export const starterBanksHash = '${starterHash}';`));
  const files = list('js/', '.js');
  const styles = list('css/', '.css');
  const version = createHash('sha256').update(JSON.stringify(manifest) +
      files.map((p) => clean(read('js/' + p))).join('') + styles.map((p) => read('css/' + p)).join('')).digest('hex').slice(0, 16);
  writeFileSync(new URL('manifest.json', root), JSON.stringify(versionManifest(manifest, version), null, 2) + '\n');
  for (const file of files) {
    const source = clean(read('js/' + file)).replace(/(['"])((?:\.\/|js\/)[^'"\n]+\.js|manifest\.json|starter-banks\.json)\1/g,
        (_, q, path) => `${q}${path}?v=${version}${q}`);
    writeFileSync(new URL('js/' + file, root), source);
  }
  for (const page of ['index.html', 'editor.html']) {
    writeFileSync(new URL(page, root), clean(read(page)).replace(/(src="js\/(?:app|theme|editor)\.js|href="css\/[a-z]+\.css)"/g,
      (_, path) => `${path}?v=${version}"`));
  }
  console.log(`Versioned browser assets: ${version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
