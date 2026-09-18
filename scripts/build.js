/**
 * Assembles the static site deployed to Vercel: the demo page, its assets and the library
 * sources, served as-is (plain ES modules, no bundling). Uses only Node built-ins.
 */
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = `${root}dist`;
/** Everything the page loads, copied with the same layout so relative URLs keep working. */
const ENTRIES = ['index.html', 'demo', 'src'];

rmSync(outDir, { recursive: true, force: true });
for (const entry of ENTRIES) {
  cpSync(`${root}${entry}`, `${outDir}/${entry}`, { recursive: true });
}
console.log(`Built ${ENTRIES.join(', ')} into dist/`);
