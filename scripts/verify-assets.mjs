// Requests every asset in the manifest from a running dev/preview server.
// Usage: node scripts/verify-assets.mjs [baseUrl]   (default http://127.0.0.1:5173)
import { MANIFEST } from '../src/assets.js';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
let bad = 0;
let total = 0;

for (const group of Object.values(MANIFEST)) {
  for (const rel of Object.values(group)) {
    total++;
    const url = `${base}/assets/${rel}`;
    const res = await fetch(url);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (res.status !== 200 || (len > 0 && len < 100)) {
      console.error(`FAIL ${res.status} ${url}`);
      bad++;
    }
  }
}

console.log(`${total - bad}/${total} assets OK`);
process.exit(bad ? 1 : 0);
