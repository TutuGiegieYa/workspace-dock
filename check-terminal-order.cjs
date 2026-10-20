'use strict';
const assert = require('node:assert/strict');
const { orderFolders, creationQueue, configureOrder } = require('./terminal-order');
const tick = () => new Promise(resolve => setImmediate(resolve));
const folder = (name, path = `/work/${name}`) => ({ name, uri: { fsPath: path, toString: () => `file://${path}` } });
const names = items => items.map(item => item.name);

(async () => {
  const roots = [folder('project-10'), folder('project-2'), folder('project-1')];
  assert.deepEqual(names(orderFolders(roots)), names(roots));
  assert.deepEqual(names(orderFolders(roots, 'nameAscending')), ['project-1', 'project-2', 'project-10']);
  assert.deepEqual(names(orderFolders(roots, 'nameDescending')), ['project-10', 'project-2', 'project-1']);
  assert.deepEqual(names(orderFolders(roots, 'custom', ['gone-project', 'project-2'])), ['project-2', 'project-10', 'project-1']);
  assert.deepEqual(names(orderFolders(roots, 'lastLaunch', [], ['file:///work/project-1', '/work/project-10'])), ['project-1', 'project-10', 'project-2']);
  assert.deepEqual(names(orderFolders(roots, 'lastLaunch')), names(roots));
  assert.deepEqual(names(roots), ['project-10', 'project-2', 'project-1'], 'Never mutate the workspace folder array');
  const duplicates = [folder('same', '/work/a'), folder('same', '/work/b')];
  assert.equal(orderFolders(duplicates, 'custom', ['file:///work/b'])[0].uri.fsPath, '/work/b');

  const reserve = creationQueue();
  const first = reserve(), failedEarly = reserve(), third = reserve();
  failedEarly.release();
  let thirdAllowed = false;
  third.turn.then(() => { thirdAllowed = true; });
  await tick(); assert.equal(thirdAllowed, false, 'An early failure cannot overtake the first slot');
  first.release(); await tick(); assert.equal(thirdAllowed, true);
  third.release();

  const choices = [], updates = [], notifications = [];
  const vscode = {
    ConfigurationTarget: { Workspace: 2 },
    workspace: { workspaceFolders: roots, getConfiguration() { return {
      async update(key, value, target) { updates.push({ key, value, target }); }
    }; } },
    window: {
      async showQuickPick(items) { choices.push(items); return choices.length === 1 ? items[1] : items.at(-1); },
      async showInformationMessage(message) { notifications.push(message); }
    }
  };
  await configureOrder(vscode);
  assert.deepEqual(updates, [
    { key: 'customTerminalOrder', value: ['project-2', 'project-10', 'project-1'], target: 2 },
    { key: 'terminalOrder', value: 'custom', target: 2 }
  ]);
  assert.equal(notifications.length, 1);
  updates.length = 0;
  vscode.window.showQuickPick = async () => undefined;
  await configureOrder(vscode);
  assert.equal(updates.length, 0, 'Cancel must not modify any setting');
  console.log('PASS: workspace/natural/custom/last order; new and removed roots; duplicate names; creation gating and skipped slots; workspace settings picker; cancel.');
})().catch(error => { console.error(error); process.exitCode = 1; });
