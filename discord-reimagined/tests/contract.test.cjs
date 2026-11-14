const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root,'index.js'),'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
test('evaluates in the exact Distra native expression wrapper',()=>{
  const factory = (0,eval)('definePlugin=>('+code+')');
  const plugin = factory(x=>x);
  assert.equal(typeof plugin.start,'function');
  assert.equal(typeof plugin.stop,'function');
  assert.equal(typeof plugin.SettingsComponent,'function');
});
test('manifest hash matches the exact source bytes',()=>{
  assert.equal(manifest.main,'index.js');assert.equal(manifest.distra.spec,1);
  assert.equal(manifest.hash,crypto.createHash('sha256').update(code).digest('hex'));
  assert.ok(code.includes('const VERSION = "'+manifest.version+'"'));
});
test('runtime has no network-client or old Favorites-route dependency',()=>{
  assert.equal(/\bfetch\s*\(/.test(code),false);
  assert.equal(code.includes('XMLHttpRequest'),false);
  assert.equal(code.includes('transitionToGuild("@favorites"'),false);
  assert.equal(code.includes('React.useReducer'),false);
});
