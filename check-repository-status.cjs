'use strict';
const assert = require('node:assert/strict');
const { registerRepositoryStatus } = require('./repository-status');
class Emitter {
  listeners = new Set();
  event = listener => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
  fire(value) { for (const listener of [...this.listeners]) listener(value); }
}
const folder = name => ({ name, uri: { fsPath: `/work/${name}`, toString: () => `file:///work/${name}` } });
const opened = new Emitter(), closed = new Emitter(), folders = new Emitter(), config = new Emitter();
const stateChanged = new Emitter();
const a = folder('a'), b = folder('b');
const repository = { rootUri: a.uri, state: {
  HEAD: { name: 'main', upstream: { name: 'origin/main' } }, indexChanges: [], workingTreeChanges: [], untrackedChanges: [], mergeChanges: [],
  onDidChange: stateChanged.event
} };
let enabled = true, known = false;
const items = [];
const commands = {}, calls = [], errors = [];
let operation = Promise.resolve();
const git = {
  getRepository(uri) { return known && uri.toString() === a.uri.toString() ? repository : null; },
  onDidOpenRepository: opened.event, onDidCloseRepository: closed.event
};
const api = {
  commands: {
    registerCommand(id, handler) { commands[id] = handler; return { dispose() { delete commands[id]; } }; },
    executeCommand(id, uri) { calls.push({ id, uri }); return operation; }
  },
  extensions: { getExtension() { return { isActive: true, exports: { getAPI: () => git } }; } },
  StatusBarAlignment: { Left: 1 },
  window: { showErrorMessage: async message => errors.push(message), createStatusBarItem(id, alignment, priority) {
    const item = { id, alignment, priority, visible: false, disposed: false,
      show() { this.visible = true; }, hide() { this.visible = false; }, dispose() { this.disposed = true; } };
    items.push(item); return item;
  } },
  workspace: {
    workspaceFolders: [a,b], getConfiguration() { return { get: () => enabled }; },
    onDidChangeWorkspaceFolders: folders.event, onDidChangeConfiguration: config.event
  }
};
const all = () => items.filter(item => !item.disposed);
const active = () => all().filter(item => item.id.startsWith('workspaceCodex.repository.'));
(async () => {
  const context = { subscriptions: [] };
  await registerRepositoryStatus(context, api);
  assert.equal(active().length, 2);
  assert.equal(active()[0].text, '$(folder) a');
  known = true; opened.fire(repository);
  assert.equal(active().length, 2, 'Late discovery must not duplicate entries');
  assert.equal(active()[0].text, '$(repo) a · $(git-branch) main');
  assert.deepEqual(active()[0].command.arguments, [a.uri], 'Branch picker is scoped to the clicked repository');
  const sync = all().find(item => item.id === 'workspaceCodex.sync.file:///work/a');
  assert.equal(sync.text, '$(sync)');
  assert.equal(sync.command.command, 'workspaceCodex.syncRepository');
  assert.deepEqual(sync.command.arguments, [a.uri], 'Sync targets only the clicked repository');
  const separators = all().filter(item => item.text === '|');
  assert.equal(separators.length, 1, 'One divider between two projects, no trailing divider');
  assert.ok(active()[0].priority > sync.priority && sync.priority > separators[0].priority
    && separators[0].priority > active()[1].priority, 'Project, sync, divider, next project');
  repository.state.HEAD.ahead = 2; repository.state.HEAD.behind = 3; stateChanged.fire();
  assert.equal(sync.text, '$(sync) 3↓ 2↑');
  let finish;
  operation = new Promise(resolve => { finish = resolve; });
  const running = commands['workspaceCodex.syncRepository'](a.uri);
  assert.equal(sync.text, '$(sync~spin)', 'Spin for the lifetime of the real command promise');
  assert.equal(sync.command, undefined, 'Disable repeat clicks while busy');
  await commands['workspaceCodex.syncRepository'](a.uri);
  assert.equal(calls.length, 1, 'Concurrent clicks never duplicate Git operations');
  assert.equal(calls[0].id, 'git.sync');
  assert.equal(calls[0].uri, a.uri);
  stateChanged.fire(); assert.equal(sync.text, '$(sync~spin)');
  finish(); await running;
  assert.equal(sync.text, '$(sync) 3↓ 2↑');
  repository.state.HEAD.upstream = undefined; stateChanged.fire();
  assert.ok(sync.text.startsWith('$(cloud-upload)'));
  operation = Promise.resolve(); await commands['workspaceCodex.syncRepository'](a.uri);
  assert.equal(calls.at(-1).id, 'git.publish', 'Unpublished branch uses native publish action');
  operation = Promise.reject(new Error('test network error'));
  await commands['workspaceCodex.syncRepository'](a.uri);
  assert.equal(errors.length, 1);
  assert.ok(!sync.text.includes('~spin'), 'Failure always clears busy state');
  repository.state.HEAD = { name: 'feature/test' };
  repository.state.untrackedChanges = [{}]; stateChanged.fire();
  assert.equal(active()[0].text, '$(repo) a · $(git-branch) feature/test*');
  repository.state.HEAD = { commit: '123456789abcdef' }; stateChanged.fire();
  assert.ok(active()[0].text.includes('1234567*'));
  api.workspace.workspaceFolders = [b,a]; folders.fire();
  assert.ok(active()[0].text.endsWith('b'));
  assert.ok(active()[0].priority > active()[1].priority, 'Preserve workspace order');
  api.workspace.workspaceFolders = [b]; folders.fire();
  assert.equal(active().length, 1);
  assert.equal(all().filter(item => item.text === '|').length, 0);
  assert.equal(stateChanged.listeners.size, 0, 'Removed roots release Git subscriptions');
  enabled = false; config.fire({ affectsConfiguration: () => true });
  assert.equal(active().length, 0);
  assert.equal(all().length, 0, 'Configuration hides sync buttons and dividers too');
  enabled = true; config.fire({ affectsConfiguration: () => true });
  assert.equal(active().length, 1);
  context.subscriptions.forEach(disposable => disposable.dispose());
  assert.equal(active().length, 0);
  assert.equal(all().length, 0, 'All status items are disposed');
  assert.equal(opened.listeners.size + closed.listeners.size + folders.listeners.size + config.listeners.size, 0);
  console.log('PASS: dynamic workspace roots; late repository discovery; branch/dirty/detached updates; scoped branch picker; ordering; removal; settings and disposal.');
})().catch(error => { console.error(error); process.exitCode = 1; });
