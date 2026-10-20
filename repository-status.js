'use strict';

// Reuse VS Code's Git model: no extra git processes, file watchers or polling.
async function registerRepositoryStatus(context, vscode) {
  const extension = vscode.extensions.getExtension('vscode.git');
  if (!extension) return;
  let disposed = false;
  const entries = new Map();
  const listeners = [];
  const clear = () => {
    for (const entry of entries.values()) {
      entry.subscription?.dispose();
      entry.item.dispose();
      entry.sync.dispose();
      entry.separator?.dispose();
    }
    entries.clear();
  };
  context.subscriptions.push({ dispose() {
    disposed = true;
    clear();
    listeners.forEach(listener => listener.dispose());
  } });
  const exports = extension.isActive ? extension.exports : await extension.activate();
  if (disposed) return;
  const git = exports.getAPI(1);
  const render = (entry, folder, repository) => {
    const item = entry.item;
    if (!repository) {
      item.text = `$(folder) ${folder.name}`;
      item.tooltip = `${folder.uri.fsPath}\n未识别到 Git 仓库`;
      item.command = undefined;
      entry.sync.hide();
    } else {
      const state = repository.state;
      const head = state.HEAD;
      const branch = head?.name || head?.commit?.slice(0, 7) || '无分支';
      const dirty = [state.indexChanges, state.workingTreeChanges, state.untrackedChanges, state.mergeChanges]
        .some(changes => changes?.length);
      item.text = `$(repo) ${folder.name} · $(git-branch) ${branch}${dirty ? '*' : ''}`;
      item.tooltip = `${folder.uri.fsPath}\n分支：${branch}${dirty ? '（有未提交改动）' : ''}\n点击选择该仓库的分支`;
      // This opens the built-in branch picker; no checkout occurs until selected.
      item.command = { command: 'git.checkout', title: '选择分支', arguments: [repository.rootUri] };
      const incoming = head?.behind || 0;
      const outgoing = head?.ahead || 0;
      entry.sync.text = '$(sync)';
      entry.sync.tooltip = `同步 ${folder.name}（先拉取，再推送）\n待拉取 ${incoming}，待推送 ${outgoing}`;
      entry.sync.command = { command: 'git.sync', title: '同步仓库', arguments: [repository.rootUri] };
      entry.sync.show();
    }
    item.show();
  };
  const refresh = () => {
    if (disposed) return;
    clear();
    if (!vscode.workspace.getConfiguration('workspaceCodex').get('showRepositoryStatus', true)) return;
    const folders = vscode.workspace.workspaceFolders || [];
    for (const [index, folder] of folders.entries()) {
      const repository = git.getRepository(folder.uri);
      const item = vscode.window.createStatusBarItem(
        `workspaceCodex.repository.${folder.uri.toString()}`, vscode.StatusBarAlignment.Left, 9999 - index * 3
      );
      item.name = `工作区仓库：${folder.name}`;
      const sync = vscode.window.createStatusBarItem(
        `workspaceCodex.sync.${folder.uri.toString()}`, vscode.StatusBarAlignment.Left, 9998 - index * 3
      );
      sync.name = `同步仓库：${folder.name}`;
      let separator;
      if (index < folders.length - 1) {
        separator = vscode.window.createStatusBarItem(
          `workspaceCodex.separator.${folder.uri.toString()}`, vscode.StatusBarAlignment.Left, 9997 - index * 3
        );
        separator.name = '工作区项目分隔符';
        separator.text = '|';
        separator.show();
      }
      const entry = { item, sync, separator };
      if (repository) entry.subscription = repository.state.onDidChange(() => render(entry, folder, repository));
      entries.set(folder.uri.toString(), entry);
      render(entry, folder, repository);
    }
  };
  listeners.push(git.onDidOpenRepository(refresh), git.onDidCloseRepository(refresh),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('workspaceCodex.showRepositoryStatus')) refresh();
    }));
  refresh();
}

module.exports = { registerRepositoryStatus };
