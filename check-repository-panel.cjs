'use strict';
const assert = require('node:assert/strict');
const { registerRepositoryStatus } = require('./repository-status');
class Emitter {
  listeners = new Set();
  event = listener => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
  fire(value) { for (const listener of [...this.listeners]) listener(value); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const uri = path => ({ fsPath: path, toString: () => `file://${path}` });
const roots = Array.from({ length: 12 }, (_, index) => ({ name: `project-${index}`, uri: uri(`/work/project-${index}`) }));
roots[11].name = '<img src=x onerror=alert(1)>';
const stateChanged = new Emitter(), opened = new Emitter(), closed = new Emitter(), folders = new Emitter(), configuration = new Emitter();
const repository = { rootUri: roots[11].uri, state: {
  HEAD: { name: 'feature/long-branch', upstream: { name: 'origin/main' }, ahead: 2, behind: 3 },
  indexChanges: [], workingTreeChanges: [], untrackedChanges: [], mergeChanges: [], onDidChange: stateChanged.event
} };
let known = true, enabled = true, location = 'panel', operation = Promise.resolve(), provider;
const commands = {}, calls = [], errors = [], items = [], views = [];
const api = {
  Uri: { joinPath: (base, ...parts) => uri(`${base.fsPath}/${parts.join('/')}`) },
  StatusBarAlignment: { Left: 1 },
  extensions: { getExtension: () => ({ isActive: true, exports: { getAPI: () => ({
    getRepository: target => known && target.toString() === repository.rootUri.toString() ? repository : undefined,
    onDidOpenRepository: opened.event, onDidCloseRepository: closed.event
  }) } }) },
  commands: {
    registerCommand(id, callback) { commands[id] = callback; return { dispose() { delete commands[id]; } }; },
    executeCommand(id, target) {
      if (commands[id]) return commands[id](target);
      calls.push({ id, target }); return operation;
    }
  },
  workspace: {
    workspaceFolders: [...roots],
    getConfiguration: () => ({ get: (key, fallback) => key === 'showRepositoryStatus' ? enabled
      : key === 'repositoryStatusLocation' ? location : fallback }),
    onDidChangeWorkspaceFolders: folders.event, onDidChangeConfiguration: configuration.event
  },
  window: {
    registerWebviewViewProvider(id, value) { assert.equal(id, 'workspaceCodex.repositories'); provider = value;
      return { dispose() { provider = undefined; } }; },
    showErrorMessage: async message => errors.push(message),
    createStatusBarItem(id) { const item = { id, show() {}, hide() {}, dispose() { this.disposed = true; } };
      items.push(item); return item; }
  }
};
function resolveView() {
  const messages = [], received = new Emitter(), visibility = new Emitter(), disposal = new Emitter();
  const view = { webview: { cspSource: 'vscode-webview:', asWebviewUri: value => value.toString(),
    onDidReceiveMessage: received.event, postMessage: async message => { messages.push(message); return true; } },
    onDidChangeVisibility: visibility.event, onDidDispose: disposal.event };
  provider.resolveWebviewView(view);
  const fixture = { view, messages, received, visibility, disposal, last: () => messages.at(-1) };
  views.push(fixture); return fixture;
}
(async () => {
  const context = { subscriptions: [], extensionUri: uri('/extension') };
  await registerRepositoryStatus(context, api);
  assert.equal(items.filter(item => !item.disposed).length, 1, 'Twelve projects contribute only one native status item');
  await commands['workspaceCodex.openRepositoryPanel']();
  assert.equal(calls.pop().id, 'workspaceCodex.repositories.focus');
  const first = resolveView();
  first.received.fire({ type: 'ready' });
  assert.equal(first.last().repositories.length, 12, 'The panel keeps every project');
  assert.equal(first.last().repositories[11].name, roots[11].name);
  assert.ok(!first.view.webview.html.includes(roots[11].name), 'Repository names never enter HTML templates');
  assert.match(first.view.webview.html, /default-src 'none'/);
  assert.match(first.view.webview.html, /script-src 'nonce-[a-f0-9]+'/);
  assert.equal(first.view.webview.options.localResourceRoots.length, 1);
  repository.state.workingTreeChanges.push({}); stateChanged.fire();
  assert.equal(first.last().repositories[11].dirty, true, 'Git updates reach the last project');
  first.received.fire({ type: 'action', action: 'checkout', folder: roots[11].uri.toString() });
  await tick(); assert.equal(calls.pop().target, repository.rootUri);
  const count = calls.length;
  for (const message of [null, { type: 'action', action: 'git.push', folder: roots[11].uri.toString() },
    { type: 'action', action: 'sync', folder: 'file:///outside-workspace' },
    { type: 'action', action: 'sync', folder: roots[0].uri.toString() }]) first.received.fire(message);
  await tick(); assert.equal(calls.length, count, 'Reject unknown actions, external roots and non-repositories');
  let finish;
  operation = new Promise(resolve => { finish = resolve; });
  first.received.fire({ type: 'action', action: 'sync', folder: roots[11].uri.toString() });
  first.received.fire({ type: 'action', action: 'sync', folder: roots[11].uri.toString() });
  assert.equal(calls.length, count + 1, 'Repeated clicks start one operation');
  assert.equal(calls.at(-1).id, 'git.sync');
  assert.equal(first.last().repositories[11].busy, true);
  finish(); await tick(); assert.equal(first.last().repositories[11].busy, false);
  repository.state.HEAD.upstream = undefined; stateChanged.fire();
  assert.equal(first.last().repositories[11].publish, true);
  operation = Promise.reject(new Error('offline'));
  first.received.fire({ type: 'action', action: 'sync', folder: roots[11].uri.toString() });
  await tick(); assert.equal(calls.at(-1).id, 'git.publish');
  assert.equal(errors.length, 1); assert.equal(first.last().repositories[11].busy, false);
  operation = Promise.resolve();
  repository.state.HEAD = { commit: '123456789abcdef' }; stateChanged.fire();
  assert.equal(first.last().repositories[11].branch, '1234567');
  assert.equal(first.last().repositories[11].canSync, false);
  known = false; closed.fire(); assert.equal(first.last().repositories[11].hasRepository, false);
  known = true; opened.fire(); assert.equal(stateChanged.listeners.size, 1);
  first.disposal.fire(); assert.equal(first.received.listeners.size, 0);
  repository.state.HEAD = { name: 'new-branch' }; stateChanged.fire();
  const second = resolveView(); second.received.fire({ type: 'ready' });
  assert.equal(second.last().repositories[11].branch, 'new-branch', 'A recreated view gets current data');
  location = 'statusBar'; configuration.fire({ affectsConfiguration: () => true });
  assert.equal(items.filter(item => !item.disposed && item.id.startsWith('workspaceCodex.repository.')).length, 12);
  location = 'panel'; configuration.fire({ affectsConfiguration: () => true });
  assert.equal(items.filter(item => !item.disposed).length, 1);
  assert.equal(stateChanged.listeners.size, 1, 'Switching modes does not leak subscriptions');
  enabled = false; configuration.fire({ affectsConfiguration: () => true });
  assert.equal(second.last().enabled, false); assert.equal(second.last().repositories.length, 0);
  assert.equal(items.filter(item => !item.disposed).length, 0);
  enabled = true; api.workspace.workspaceFolders = []; folders.fire();
  assert.equal(second.last().repositories.length, 0); assert.ok(second.last().message);
  assert.equal(stateChanged.listeners.size, 0);
  context.subscriptions.forEach(subscription => subscription.dispose());
  assert.equal(provider, undefined);
  assert.equal(Object.keys(commands).length, 0);
  for (const fixture of views) assert.equal(fixture.received.listeners.size + fixture.visibility.listeners.size + fixture.disposal.listeners.size, 0);
  assert.equal(opened.listeners.size + closed.listeners.size + folders.listeners.size + configuration.listeners.size, 0);
  api.extensions.getExtension = () => undefined;
  const noGit = { subscriptions: [], extensionUri: uri('/extension') };
  await registerRepositoryStatus(noGit, api);
  const unavailable = resolveView();
  assert.match(unavailable.last().message, /Git/);
  assert.equal(unavailable.last().repositories.length, 0);
  noGit.subscriptions.forEach(subscription => subscription.dispose());
  assert.equal(unavailable.received.listeners.size, 0);
  console.log('PASS: wrapping-panel model; all roots; scoped actions; duplicate sync; failures; CSP; late Git changes; view recreation; mode switching; disposal.');
})().catch(error => { console.error(error); process.exitCode = 1; });
