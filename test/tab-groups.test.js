const test = require('node:test');
const assert = require('node:assert/strict');
const groups = require('../renderer/tab-groups');

test('group creation trims names and accepts only palette colors', () => {
  const result = groups.addGroup([], '  Study  ', 'purple', 'g1');
  assert.deepEqual(result.group, { id: 'g1', name: 'Study', color: 'purple', collapsed: false });
  assert.equal(groups.addGroup([], '   ', 'blue', 'g2').group, null);
  assert.equal(groups.addGroup([], 'Work', '#fff', 'g3').group.color, 'blue');
});

test('membership restore drops references to deleted groups', () => {
  const tabs = [{ id: 1, groupId: 'g1' }, { id: 2, groupId: 'missing' }];
  assert.deepEqual(groups.normalizeMembership(tabs, [{ id: 'g1', name: 'Study' }]).map((tab) => tab.groupId), ['g1', null]);
});

test('assigning a tab moves it to a valid group or clears membership', () => {
  const tabs = [{ id: 1 }, { id: 2, groupId: 'g1' }], defs = [{ id: 'g1', name: 'Study' }, { id: 'g2', name: 'Work' }];
  assert.deepEqual(groups.assignTab(tabs, 1, 'g2', defs).map((tab) => tab.groupId), ['g2', 'g1']);
  assert.deepEqual(groups.assignTab(tabs, 1, 'unknown', defs).map((tab) => tab.groupId), [null, 'g1']);
  assert.equal(groups.assignTab(tabs, 3, 'g1', defs), null);
});

test('removing a group ungroups its tabs, closing a group removes only its tabs', () => {
  const defs = [{ id: 'g1', name: 'Study' }, { id: 'g2', name: 'Work' }], tabs = [{ id: 1, groupId: 'g1' }, { id: 2, groupId: 'g2' }, { id: 3 }];
  assert.deepEqual(groups.removeGroup(defs, tabs, 'g1').tabs.map((tab) => tab.groupId), [null, 'g2', null]);
  assert.deepEqual(groups.closeGroupTabs(tabs, 'g1').map((tab) => tab.id), [2, 3]);
});

test('group definitions reject duplicates and bound the list', () => {
  assert.equal(groups.normalizeGroups([{ id: 'same', name: 'One' }, { id: 'same', name: 'Duplicate' }]).length, 1);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `g${i}`, name: `G${i}` }));
  assert.equal(groups.addGroup(many, 'Extra', 'blue', 'extra').group, null);
});
