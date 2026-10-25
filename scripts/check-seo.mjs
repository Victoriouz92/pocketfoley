import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const canonical = 'https://victoriouz92.github.io/pocketfoley/';
const remote = process.env.SEO_TEST_URL;
const base = remote ? new URL(remote) : new URL(canonical);
async function read(relative) {
  if (!remote) return readFileSync(`dist/${relative || 'index.html'}`, 'utf8');
  const response = await fetch(new URL(relative, base));
  assert.equal(response.status, 200, relative || '/');
  assert(!/noindex/i.test(response.headers.get('x-robots-tag') ?? ''), relative);
  return response.text();
}
const html = await read('');
assert(html.includes('<html lang="en">'));
assert.equal([...html.matchAll(/rel="canonical"/g)].length, 1);
assert(html.includes(`rel="canonical" href="${canonical}"`));
assert(html.includes(`property="og:url" content="${canonical}"`));
assert(html.includes('name="twitter:card" content="summary"'));
assert(html.includes('Browser Sound Effects Studio &amp; WAV Export'));
assert(!/<meta[^>]+content="[^"]*noindex/i.test(html));
assert(html.includes('id="pocketfoley-guide"'));
assert(html.includes('Can I use exported sounds in commercial projects?'));
assert(html.includes('offline reopening depends on'));
assert(html.includes('48 kHz WAV'));
assert.equal([...html.matchAll(/<h1(?:\s|>)/g)].length, 1);
const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
assert(json);
const graph = JSON.parse(json)['@graph'];
const app = graph.find((node) => node['@type'] === 'WebApplication');
assert.equal(app.url, canonical);
assert.equal(app.inLanguage, 'en');
assert(!app.aggregateRating && !app.review, 'No invented ratings');
const sitemap = await read('sitemap.xml');
assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]), [canonical]);
const manifest = JSON.parse(await read('manifest.webmanifest'));
assert.equal(manifest.start_url, './');
assert.equal(manifest.scope, './');
for (const icon of manifest.icons) await read(icon.src);
for (const [, asset] of html.matchAll(/(?:src|href)="([^"#]*(?:\/assets\/|\.\/assets\/|\.\/icons\/)[^"]*)"/g)) {
  const url = new URL(asset, canonical);
  assert(url.pathname.startsWith('/pocketfoley/'), `Asset must keep deployment prefix: ${asset}`);
  await read(url.pathname.slice('/pocketfoley/'.length));
}
await read('sw.js');
if (remote && base.hostname !== 'localhost') {
  assert.equal((await fetch(new URL('seo-missing-page-check/', base))).status, 404);
}
console.log(`PASS: canonical/social metadata, visible guide, application data, sitemap, subpath assets, manifest and service worker${remote && base.hostname !== 'localhost' ? '; production 404' : ''}.`);
