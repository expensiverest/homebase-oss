const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, manifest.main), 'utf8');
test('manifest names the exact validated Distra-native entry point', () => {
  assert.equal(manifest.main, 'next.js');
  assert.equal(manifest.version, '0.2.0-alpha.1');
  assert.equal(manifest.distra.spec, 1);
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'), manifest.hash);
});
test('evaluates inside the exact Distra native expression wrapper', () => {
  const factory = new Function('return (definePlugin=>(' + source + '));')();
  const definition = factory(p => p);
  for (const method of ['start', 'stop', 'SettingsComponent']) assert.equal(typeof definition[method], 'function');
});
test('native settings host and scroll-aware headers are present without global token access', () => {
  assert.match(source, /DISTRA_CUSTOM_PAGE/);
  assert.match(source, /stickyHeaderHiddenOnScroll: true/);
  assert.match(source, /label: "Servers"/);
  assert.doesNotMatch(source, /label: "Spaces"/);
  assert.doesNotMatch(source, /getToken\s*\(|XMLHttpRequest|fetch\s*\(/);
});
