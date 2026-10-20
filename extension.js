'use strict';
const vscode = require('vscode');
const { orderFolders, creationQueue, configureOrder } = require('./terminal-order');
const TYPE = 'workspace-codex';
const MARKER = 'CODEX_WORKSPACE_RESUME_ROOT';
const PROTOCOL = 'CODEX_WORKSPACE_RESUME_PROTOCOL';
let pendingRun;
let workspaceState;
const failedTerminals = new WeakSet();

function shellQuote(value) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function codexCommand(folder) {
  const shared = vscode.workspace.getConfiguration('workspaceCodex').get('useSharedCodexBackend', false);
  const backend = shared ? '' : ' --no-daemon';
  return `python3 ${shellQuote(`${__dirname}/codex-title.py`)} --project ${shellQuote(folder.name)} -- codex resume${backend} -c 'tui.terminal_title=["thread-name"]'`;
}

function ensureNotCancelled(signal) {
  if (signal?.aborted) throw new Error('终端组启动已取消。');
}

function waitForShell(terminal, signal) {
  ensureNotCancelled(signal);
  if (terminal.shellIntegration) return Promise.resolve(terminal.shellIntegration);
  return new Promise((resolve, reject) => {
    let timer;
    const disposables = [];
    const finish = (error, integration) => {
      clearTimeout(timer);
      disposables.forEach(d => d.dispose());
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(integration);
    };
    const abort = () => finish(new Error('终端组启动已取消。'));
    disposables.push(
      vscode.window.onDidChangeTerminalShellIntegration(event => {
        if (event.terminal === terminal) finish(undefined, event.shellIntegration);
      }),
      vscode.window.onDidCloseTerminal(closed => {
        if (closed === terminal) finish(new Error('Bash 已关闭。'));
      })
    );
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new Error('Bash 初始化超时；未启动 Codex。')), 15000);
  });
}

function checkEnvironment(terminal, command, signal) {
  ensureNotCancelled(signal);
  return new Promise((resolve, reject) => {
    let execution;
    let timer;
    const disposables = [];
    const finish = error => {
      clearTimeout(timer);
      disposables.forEach(d => d.dispose());
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    };
    const abort = () => finish(new Error('终端组启动已取消。'));
    disposables.push(
      vscode.window.onDidEndTerminalShellExecution(event => {
        if (event.terminal === terminal && event.execution === execution) {
          finish(event.exitCode === 0 ? undefined : new Error('Python 环境初始化未成功；未启动 Codex。'));
        }
      }),
      vscode.window.onDidCloseTerminal(closed => {
        if (closed === terminal) finish(new Error('Bash 已关闭。'));
      })
    );
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new Error('等待环境检查完成超时；未启动 Codex。')), 30000);
    try {
      execution = terminal.shellIntegration.executeCommand(command);
    } catch (error) { finish(error); }
  });
}

async function getPythonApi() {
  const extension = vscode.extensions.getExtension('ms-python.vscode-python-envs');
  if (!extension) {
    if (vscode.extensions.getExtension('ms-python.python')) {
      throw new Error('请启用 Python Environments 扩展，以等待 Python 环境激活完成。');
    }
    return undefined;
  }
  const api = extension.isActive ? extension.exports : await extension.activate();
  if (!api?.getEnvironment || !api?.createTerminal) {
    throw new Error('Python Environments 接口尚未就绪，请重新加载窗口。');
  }
  return api;
}

function waitForEnvironment(python, folder, signal) {
  ensureNotCancelled(signal);
  // getEnvironment deliberately returns after one second, even if discovery
  // is still running. Subscribe before querying so a cold-start event is not lost.
  return new Promise((resolve, reject) => {
    let settled = false;
    let retry;
    let timeout;
    let changed;
    const finish = (error, environment) => {
      if (settled) return;
      settled = true;
      clearTimeout(retry);
      clearTimeout(timeout);
      changed?.dispose();
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(environment);
    };
    const abort = () => finish(new Error('终端组启动已取消。'));
    const read = async () => {
      try {
        const environment = await python.getEnvironment(folder.uri);
        if (settled) return;
        if (environment) return finish(undefined, environment);
        retry = setTimeout(read, 500);
      } catch (error) { finish(error); }
    };
    changed = python.onDidChangeEnvironment?.(event => {
      if (event.uri?.toString() === folder.uri.toString() && event.new) {
        finish(undefined, event.new);
      }
    });
    signal?.addEventListener('abort', abort, { once: true });
    timeout = setTimeout(() => finish(new Error(
      `${folder.name}: 等待 Python 环境就绪超时（60 秒）；请确认该文件夹已选择解释器，然后重试。`
    )), 60000);
    void read();
  });
}

async function startWorkspaceTerminals(signal) {
  if (!vscode.workspace.isTrusted) {
    throw new Error('请先信任工作区，再启动 Codex。');
  }
  // Read on every invocation: adding/removing a root never needs task edits.
  const config = vscode.workspace.getConfiguration('workspaceCodex');
  const folders = orderFolders(vscode.workspace.workspaceFolders || [],
    config.get('terminalOrder', 'workspace'), config.get('customTerminalOrder', []),
    workspaceState?.get('workspaceCodex.lastTerminalOrder', []) || []);
  if (!folders.length) throw new Error('当前工作区没有打开的文件夹。');
  // Debugpy contributes PATH and BUNDLED_DEBUGPY_PATH during activation.
  // Finish that before creating Bash, otherwise the first tab becomes stale.
  const debuggerExtension = vscode.extensions.getExtension('ms-python.debugpy');
  if (debuggerExtension && !debuggerExtension.isActive) {
    await debuggerExtension.activate();
  }
  ensureNotCancelled(signal);
  const python = await getPythonApi();
  ensureNotCancelled(signal);
  const reserve = creationQueue();
  const results = await Promise.allSettled(folders.map(folder => {
    const slot = reserve();
    return (async () => {
      ensureNotCancelled(signal);
      const root = folder.uri.toString();
      const existing = vscode.window.terminals.find(terminal =>
        terminal.exitStatus === undefined &&
        !failedTerminals.has(terminal) &&
        terminal.creationOptions?.env?.[MARKER] === root &&
        terminal.creationOptions?.env?.[PROTOCOL] === '4'
      );
      if (existing) {
        return { terminal: existing, reused: true, root };
      }
      const options = {
        // Empty (not undefined): Python Environments otherwise pins "Python" as
        // a static terminal name, preventing OSC session titles from appearing.
        name: '',
        cwd: folder.uri,
        shellPath: '/usr/bin/bash',
        // VS Code injects its Bash integration only for empty/login arguments.
        // Passing ['-i'] prevents injection, despite Bash being interactive.
        shellArgs: [],
        env: { [MARKER]: root, [PROTOCOL]: '4' }
      };
      const environment = python ? await waitForEnvironment(python, folder, signal) : undefined;
      await slot.turn;
      ensureNotCancelled(signal);
      // The Python API owns activation, avoiding a race with its on-open handler.
      // It resolves after command-mode activation has completed.
      // Reserve display positions only until VS Code confirms that each tab is
      // open. Its Python activation can continue while the next tab is created.
      let opened;
      opened = vscode.window.onDidOpenTerminal(terminal => {
        if (terminal.creationOptions?.env?.[MARKER] !== root) return;
        slot.release();
        opened?.dispose();
      });
      let terminal;
      try {
        terminal = environment
          ? await python.createTerminal(environment, options)
          : vscode.window.createTerminal(options);
      } finally { opened.dispose(); slot.release(); }
      try {
        ensureNotCancelled(signal);
        terminal.show(true);
        await waitForShell(terminal, signal);
        const manager = environment?.envId?.managerId || '';
        let check = 'true';
        if (/conda/i.test(manager) && environment.sysPrefix) {
          check = `test "$CONDA_PREFIX" = ${shellQuote(environment.sysPrefix)}`;
        } else if (/venv|virtualenv/i.test(manager) && environment.sysPrefix) {
          check = `test "$VIRTUAL_ENV" = ${shellQuote(environment.sysPrefix)}`;
        }
        // Wait for this command's actual completion, not a fixed sleep or just PID.
        await checkEnvironment(terminal, check, signal);
        ensureNotCancelled(signal);
        terminal.shellIntegration.executeCommand(codexCommand(folder));
      } catch (error) {
        failedTerminals.add(terminal);
        throw new Error(`${folder.name}: ${error.message}`);
      }
      return { terminal, reused: false, root };
    })().finally(slot.release);
  }));
  const successes = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason.message);
  if (successes.length) {
    try { await workspaceState?.update('workspaceCodex.lastTerminalOrder', successes.map(result => result.root)); }
    catch { console.warn('Workspace Dock: unable to save terminal launch order.'); }
  }
  return {
    created: successes.filter(result => !result.reused).length,
    reused: successes.filter(result => result.reused).length,
    first: successes[0]?.terminal,
    errors
  };
}

function openWorkspaceTerminals(signal) {
  // The command palette and task can be invoked at the same time.
  if (!pendingRun) {
    pendingRun = startWorkspaceTerminals(signal).finally(() => { pendingRun = undefined; });
  }
  return pendingRun;
}

function makeTask(definition, scope = vscode.TaskScope.Workspace) {
  const execution = new vscode.CustomExecution(async () => {
    const write = new vscode.EventEmitter();
    const exit = new vscode.EventEmitter();
    const controller = new AbortController();
    return {
      onDidWrite: write.event,
      onDidClose: exit.event,
      async open() {
        try {
          const { created, reused, first, errors } = await openWorkspaceTerminals(controller.signal);
          write.fire(`已创建 ${created} 个终端，保留 ${reused} 个已有终端。\r\n`);
          for (const error of errors) write.fire(`${error}\r\n`);
          if (errors.length) {
            void vscode.window.showErrorMessage(errors.join('\n'));
          }
          exit.fire(errors.length ? 1 : 0);
          setTimeout(() => first?.show(true), 0);
        } catch (error) {
          write.fire(`${error.message}\r\n`);
          exit.fire(1);
        }
      },
      close() { controller.abort(); write.dispose(); exit.dispose(); }
    };
  });
  const task = new vscode.Task(
    definition, scope, '打开工作区终端组', 'Codex', execution, []
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Silent,
    panel: vscode.TaskPanelKind.Dedicated,
    echo: false,
    showReuseMessage: false,
    close: true
  };
  return task;
}

function activate(context) {
  workspaceState = context.workspaceState;
  void require('./repository-status').registerRepositoryStatus(context, vscode).catch(error => {
    void vscode.window.showErrorMessage(`工作区仓库状态栏初始化失败：${error.message}`);
  });
  context.subscriptions.push(
    vscode.commands.registerCommand('workspaceCodex.configureTerminalOrder', () => configureOrder(vscode)),
    vscode.window.registerUriHandler({
      async handleUri(uri) {
        // One fixed action only; external links cannot supply shell commands.
        if (uri.path !== '/open' || uri.query || uri.fragment) return;
        await vscode.commands.executeCommand('workspaceCodex.resumeAll');
      }
    }),
    vscode.commands.registerCommand('workspaceCodex.resumeAll', async () => {
      try {
        const { first, errors } = await openWorkspaceTerminals();
        first?.show(true);
        if (errors.length) await vscode.window.showErrorMessage(errors.join('\n'));
      } catch (error) {
        await vscode.window.showErrorMessage(error.message);
      }
    }),
    vscode.tasks.registerTaskProvider(TYPE, {
      provideTasks() {
        if (!vscode.workspace.workspaceFolders?.length) return [];
        return [makeTask({ type: TYPE, action: 'resumeAll' })];
      },
      resolveTask(task) {
        if (task.definition.action !== 'resumeAll') return undefined;
        return makeTask(task.definition, task.scope);
      }
    })
  );
}
exports.activate = activate;
