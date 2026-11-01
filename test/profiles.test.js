const test = require('node:test');
const assert = require('node:assert/strict');
const profiles = require('../renderer/profile-utils');

test('default profile is always present and profile names and ids are unique', () => {
  const result = profiles.normalizeProfiles([
    { id: 'work-001', name: ' Work ' },
    { id: 'work-001', name: 'Duplicate id' },
    { id: 'other-001', name: 'work' },
    { id: '../bad', name: 'Bad id' },
    { id: 'home-001', name: 'Home' },
  ]);
  assert.deepEqual(result.map(x => x.name), ['Personal', 'Work', 'Home']);
});

test('profile creation validates empty, duplicate, overlong, and capped names', () => {
  assert.equal(profiles.validateProfileName('  ', []).code, 'empty');
  assert.equal(profiles.validateProfileName('personal', []).code, 'duplicate');
  assert.equal(profiles.validateProfileName('a'.repeat(29), []).code, 'too-long');
  const capped = Array.from({ length: 9 }, (_, i) => ({ id: `profile-${i}`, name: `Profile ${i}` }));
  assert.equal(profiles.validateProfileName('Extra', capped).code, 'limit');
  assert.deepEqual(profiles.validateProfileName(' Work ', []), { ok: true, name: 'Work' });
});

test('only valid non-default IDs produce persistent Electron partitions', () => {
  assert.equal(profiles.partitionFor('default'), null);
  assert.equal(profiles.partitionFor('../outside'), null);
  assert.equal(profiles.partitionFor('work-001'), 'persist:aegora-profile-work-001');
});
