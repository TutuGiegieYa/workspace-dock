'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
class EventEmitter {
  constructor() { this.listeners = new Set(); this.event = listener => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; }; }
  fire(value) { for (const listener of [...this.listeners]) listener(value); }
  dispose() { this.listeners.clear(); }
}
const folder = name => ({ name, uri: { toString: () => `file:///work/${name}` } });
const shell = new EventEmitter(), ended = new EventEmitter(), closed = new EventEmitter();
const opened = new EventEmitter();
const selection = new EventEmitter();
const activations = [], checks = [], errors = [], commands = {};
const isLaunch = command => command.includes('codex-title.py') && command.includes('codex resume');
let sharedBackend = false;
let orderMode = 'workspace', customOrder = [];
let uriHandler;
const debuggerReady = deferred();
let debuggerActive = false;
let debuggerActivationCount = 0;
const environments = {
  a: { envId: { managerId: 'python:conda' }, sysPrefix: '/conda/envs/another-name' },
  b: { envId: { managerId: 'python:venv' }, sysPrefix: "/work/a quote'/venv" }
};
const api = {
  workspace: { isTrusted: true, workspaceFolders: [folder('a'), folder('b')],
    getConfiguration() { return { get: (key, fallback) => key === 'useSharedCodexBackend' ? sharedBackend
      : key === 'terminalOrder' ? orderMode : key === 'customTerminalOrder' ? customOrder : fallback }; } },
  window: {
    registerUriHandler(handler) { uriHandler = handler; return { dispose() {} }; },
    terminals: [],
    onDidChangeTerminalShellIntegration: shell.event,
    onDidEndTerminalShellExecution: ended.event,
    onDidCloseTerminal: closed.event,
    onDidOpenTerminal: opened.event,
    showErrorMessage: async error => errors.push(error),
    createTerminal(options) {
      const terminal = { creationOptions: options, sent: [], show() {}, sendText() { throw new Error('sendText must not be used'); } };
      terminal.shellIntegration = {
        executeCommand(command) {
          terminal.sent.push(command);
          const execution = {};
          if (!isLaunch(command)) checks.push({ terminal, execution, command });
          return execution;
        }
      };
      this.terminals.push(terminal);
      opened.fire(terminal);
      return terminal;
    }
  },
  extensions: {
    getExtension(id) {
      if (id === 'ms-python.debugpy') return { isActive: debuggerActive, async activate() {
        debuggerActivationCount++;
        await debuggerReady.promise;
        debuggerActive = true;
      } };
      if (id !== 'ms-python.vscode-python-envs') return undefined;
      return { isActive: true, exports: {
        onDidChangeEnvironment: selection.event,
        async getEnvironment(uri) { return environments[uri.toString().split('/').at(-1)]; },
        async createTerminal(environment, options) {
          const terminal = api.window.createTerminal(options);
          const ready = deferred();
          activations.push({ ready, terminal, environment });
          await ready.promise;
          return terminal;
        }
      } };
    }
  },
  commands: {
    registerCommand(id, fn) { commands[id] = fn; return { dispose() {} }; },
    executeCommand(id) { return commands[id](); }
  },
  tasks: { registerTaskProvider() { return { dispose() {} }; } },
  EventEmitter
};
const filename = '/tmp/check-workspace-codex.cjs', mod = new Module(filename);
mod.filename = filename;
mod.require = id => {
  if (id === './repository-status') return require('./repository-status');
  if (id === './terminal-order') return require('./terminal-order');
  assert.equal(id, 'vscode'); return api;
};
mod._compile(fs.readFileSync(`${__dirname}/extension.js`, 'utf8') + '\nexports.waitForEnvironment = waitForEnvironment;', filename);
const savedState = new Map();
mod.exports.activate({ subscriptions: [], workspaceState: {
  get: (key, fallback) => savedState.get(key) || fallback,
  update: async (key, value) => savedState.set(key, value)
} });

(async () => {
  const first = commands['workspaceCodex.resumeAll']();
  const concurrent = commands['workspaceCodex.resumeAll']();
  await tick();
  assert.equal(activations.length, 0, 'Debugpy environment contributions must finish before any terminal');
  assert.equal(debuggerActivationCount, 1, 'Concurrent invocations share debugger initialization');
  debuggerReady.resolve();
  await tick();
  assert.equal(activations.length, 2, 'Both projects must begin activation before either finishes');
  assert.deepEqual(activations[0].terminal.creationOptions.shellArgs, []);
  assert.equal(activations[0].terminal.creationOptions.name, '', 'Do not let Python pin a static terminal name');
  assert.deepEqual(activations[0].terminal.sent, []);
  assert.deepEqual(activations[1].terminal.sent, []);
  activations[0].ready.resolve();
  await tick();
  assert.equal(checks.length, 1);
  assert.equal(checks[0].command, 'test "$CONDA_PREFIX" = \'/conda/envs/another-name\'');
  assert.ok(!activations[0].terminal.sent.some(isLaunch));
  ended.fire({ ...checks[0], exitCode: 0 });
  await tick();
  assert.ok(isLaunch(activations[0].terminal.sent.at(-1)));
  assert.ok(activations[0].terminal.sent.at(-1).includes('"thread-name"'), 'Unnamed sessions must not fall back to thread IDs');
  assert.ok(activations[0].terminal.sent.at(-1).includes('--no-daemon'), 'Default CLI must not leave a writer in a shared daemon');
  assert.equal(activations.length, 2);
  assert.deepEqual(activations[1].terminal.sent, []);
  activations[1].ready.resolve();
  await tick();
  assert.ok(checks[1].command.startsWith('test "$VIRTUAL_ENV" = '));
  assert.ok(checks[1].command.includes("'\\''"));
  ended.fire({ ...checks[1], exitCode: 0 });
  await Promise.all([first, concurrent]);
  assert.equal(api.window.terminals.length, 2);
  assert.deepEqual(savedState.get('workspaceCodex.lastTerminalOrder'), ['file:///work/a', 'file:///work/b']);
  await commands['workspaceCodex.resumeAll']();
  assert.equal(api.window.terminals.length, 2);
  await uriHandler.handleUri({ path: '/open', query: '', fragment: '' });
  assert.equal(api.window.terminals.length, 2, 'URI action must reuse live terminals');
  let calls = 0;
  const execute = api.commands.executeCommand;
  api.commands.executeCommand = async id => { assert.equal(id, 'workspaceCodex.resumeAll'); calls++; };
  await uriHandler.handleUri({ path: '/open', query: '', fragment: '' });
  await uriHandler.handleUri({ path: '/wrong', query: '', fragment: '' });
  await uriHandler.handleUri({ path: '/open', query: 'command=anything', fragment: '' });
  await uriHandler.handleUri({ path: '/open', query: '', fragment: 'anything' });
  assert.equal(calls, 1, 'Only the fixed URI without parameters may launch terminals');
  api.commands.executeCommand = execute;
  api.workspace.workspaceFolders = [folder('a')];
  activations[0].terminal.exitStatus = { code: 0 };
  const failing = commands['workspaceCodex.resumeAll']();
  await tick(); activations[2].ready.resolve(); await tick();
  ended.fire({ ...checks[2], exitCode: 1 });
  await failing;
  assert.ok(!activations[2].terminal.sent.some(isLaunch));
  assert.equal(errors.length, 1);
  // Failed initialization is not incorrectly reused as an already running session.
  const retry = commands['workspaceCodex.resumeAll']();
  await tick(); assert.equal(activations.length, 4);
  activations[3].ready.resolve(); await tick();
  ended.fire({ ...checks[3], exitCode: 0 }); await retry;
  assert.ok(isLaunch(activations[3].terminal.sent.at(-1)));
  // A URI can arrive before the Python extension has discovered saved selections.
  api.workspace.workspaceFolders = [folder('cold-event'), folder('cold-poll')];
  sharedBackend = true;
  const cold = uriHandler.handleUri({ path: '/open', query: '', fragment: '' });
  await tick();
  assert.equal(activations.length, 4, 'No terminal until its selection is known');
  selection.fire({ uri: folder('unrelated').uri, new: environments.a });
  await tick(); assert.equal(activations.length, 4);
  selection.fire({ uri: folder('cold-event').uri, new: environments.a });
  await tick();
  assert.equal(activations.length, 5, 'Ready root starts while another is still discovering');
  activations[4].ready.resolve(); await tick();
  ended.fire({ ...checks[4], exitCode: 0 }); await tick();
  assert.ok(isLaunch(activations[4].terminal.sent.at(-1)));
  environments['cold-poll'] = environments.b;
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(activations.length, 6, 'Retry discovers a selection even without an event');
  activations[5].ready.resolve(); await tick();
  ended.fire({ ...checks[5], exitCode: 0 }); await cold;
  assert.ok(isLaunch(activations[5].terminal.sent.at(-1)));
  assert.ok(!activations[5].terminal.sent.at(-1).includes('--no-daemon'), 'Shared backend remains configurable');
  assert.equal(selection.listeners.size, 0, 'Selection subscriptions must be cleaned up');
  // Reverse environment discovery relative to the configured display order.
  api.workspace.workspaceFolders = [folder('order-a'), folder('order-b')];
  orderMode = 'custom'; customOrder = ['order-b', 'order-a'];
  const slowFirst = deferred();
  environments['order-a'] = environments.a;
  environments['order-b'] = slowFirst.promise;
  const ordered = commands['workspaceCodex.resumeAll']();
  await tick();
  assert.equal(activations.length, 6, 'A fast later project must not take the earlier tab position');
  slowFirst.resolve(environments.b); await tick();
  assert.equal(activations.length, 8, 'Both tabs start activation before either completes');
  assert.equal(activations[6].terminal.creationOptions.cwd.toString(), 'file:///work/order-b');
  assert.equal(activations[7].terminal.creationOptions.cwd.toString(), 'file:///work/order-a');
  activations[7].ready.resolve(); await tick();
  ended.fire({ ...checks[6], exitCode: 0 }); await tick();
  assert.ok(isLaunch(activations[7].terminal.sent.at(-1)), 'Later project need not wait for earlier activation');
  assert.deepEqual(activations[6].terminal.sent, []);
  activations[6].ready.resolve(); await tick();
  ended.fire({ ...checks[7], exitCode: 0 }); await ordered;
  assert.deepEqual(savedState.get('workspaceCodex.lastTerminalOrder'), ['file:///work/order-b','file:///work/order-a']);
  orderMode = 'lastLaunch';
  await commands['workspaceCodex.resumeAll']();
  assert.equal(activations.length, 8, 'Reuse leaves existing live tabs in place');
  assert.equal(opened.listeners.size, 0, 'Creation listeners are cleaned up');
  console.log('PASS: configured tab order survives reverse discovery; activations stay parallel; last successful order persists; existing tabs are reused.');
  const controller = new AbortController();
  const cancelled = mod.exports.waitForEnvironment({ getEnvironment: async () => undefined,
    onDidChangeEnvironment: selection.event }, folder('never-ready'), controller.signal);
  controller.abort();
  await assert.rejects(cancelled, /取消/);
  assert.equal(selection.listeners.size, 0);
  assert.equal(debuggerActivationCount, 1, 'Active debugger must not be initialized again');
  console.log('PASS: debugger activation completes before terminal creation; concurrent invocations share initialization.');
  console.log('PASS: cold URI start waits for environment discovery; unrelated events ignored; ready roots start independently; polling fallback; cancellation and cleanup.');
  console.log('PASS: parallel folder initialization; waits for activation AND shell completion; per-folder Conda/venv paths; quoting; concurrent calls; duplicate prevention; failed activation and retry.');
})().catch(error => { console.error(error); process.exitCode = 1; });
