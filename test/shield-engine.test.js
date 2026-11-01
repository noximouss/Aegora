const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FiltersEngine, Request } = require('@ghostery/adblocker');

const bundled = path.join(__dirname, '..', 'build');
const ads = FiltersEngine.deserialize(fs.readFileSync(path.join(bundled, 'shield-engine-0.bin')));
const privacy = FiltersEngine.deserialize(fs.readFileSync(path.join(bundled, 'shield-engine-1.bin')));
const combined = FiltersEngine.deserialize(fs.readFileSync(path.join(bundled, 'shield-engine.bin')));
function matches(engine, url, type = 'script', source = 'https://example.com/') {
  return engine.match(Request.fromRawDetails({ id: 1, url, resourceType: type, referrer: source, webContentsId: 1 })).match;
}

test('EasyList blocks a known third-party ad request', () => {
  assert.equal(matches(combined, 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'), true);
});

test('EasyPrivacy blocks a known analytics request and classifies it as tracking', () => {
  const url = 'https://www.google-analytics.com/g/collect?v=2';
  assert.equal(matches(combined, url), true);
  assert.equal(matches(privacy, url), true);
});

test('ordinary Google and Gmail top-level pages are not blocked', () => {
  for (const url of ['https://www.google.com/', 'https://accounts.google.com/', 'https://mail.google.com/mail/u/0/']) {
    assert.equal(matches(combined, url, 'main_frame'), false, url);
  }
});

test('YouTube main-frame navigation remains available', () => {
  assert.equal(matches(combined, 'https://www.youtube.com/watch?v=example', 'main_frame'), false);
});
