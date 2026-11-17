'use strict';
const { registerRepositoryPanel } = require('./repository-panel');

// Reuse VS Code's Git model: no extra git processes, file watchers or polling.
async function registerRepositoryStatus(context, vscode) {
  const extension = vscode.extensions.getExtension('vscode.git');
  if (!extension) {
    const panel = registerRepositoryPanel(context, vscode, () => {});
    panel.update({ enabled: true, repositories: [], message: '请启用 VS Code 内置 Git 扩展以显示仓库状态。' });
    context.subscriptions.push(vscode.commands.registerCommand('workspaceCodex.openRepositoryPanel', () =>
      vscode.commands.executeCommand('workspaceCodex.repositories.focus')));
    return;
  }
  let disposed = false;
  const entries = new Map();
  const running = new Set();
  const listeners = [];
  let summary;
  const clear = () => {
    for (const entry of entries.values()) {
      entry.subscription?.dispose();
      entry.item?.dispose();
      entry.sync?.dispose();
      entry.separator?.dispose();
    }
    entries.clear();
    summary?.dispose();
    summary = undefined;
  };
  context.subscriptions.push({ dispose() {
    disposed = true;
    clear();
    listeners.forEach(listener => listener.dispose());
  } });
  const exports = extension.isActive ? extension.exports : await extension.activate();
  if (disposed) return;
  const git = exports.getAPI(1);
  const panel = registerRepositoryPanel(context, vscode, async (action, folderUri) => {
    if (disposed || !vscode.workspace.getConfiguration('workspaceCodex').get('showRepositoryStatus', true)) return;
    const folder = vscode.workspace.workspaceFolders?.find(folder => folder.uri.toString() === folderUri);
    const repository = folder && git.getRepository(folder.uri);
    if (!repository) return;
    if (action === 'checkout') await vscode.commands.executeCommand('git.checkout', repository.rootUri);
    else if (action === 'sync') await vscode.commands.executeCommand('workspaceCodex.syncRepository', repository.rootUri);
  });
  const updatePanel = () => {
    const enabled = vscode.workspace.getConfiguration('workspaceCodex').get('showRepositoryStatus', true);
    const repositories = enabled ? (vscode.workspace.workspaceFolders || []).map(folder => {
      const repository = git.getRepository(folder.uri);
      const state = repository?.state;
      const head = state?.HEAD;
      return {
        folder: folder.uri.toString(), name: folder.name, path: folder.uri.fsPath,
        hasRepository: !!repository,
        branch: head?.name || head?.commit?.slice(0, 7) || '无分支',
        dirty: !!state && [state.indexChanges, state.workingTreeChanges, state.untrackedChanges, state.mergeChanges]
          .some(changes => changes?.length > 0),
        ahead: head?.ahead || 0, behind: head?.behind || 0,
        busy: !!repository && running.has(repository.rootUri.toString()),
        publish: !!head?.name && !head.upstream, canSync: !!head?.name
      };
    }) : [];
    panel.update({ enabled, repositories, message: !enabled ? '工作区 Git 状态已在设置中关闭。'
      : !repositories.length ? '打开一个文件夹或多文件夹工作区后，这里会显示项目。' : '' });
  };
  const render = (entry, folder, repository) => {
    const item = entry.item;
    if (!item) return;
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
      const busy = running.has(repository.rootUri.toString());
      const publish = !!head?.name && !head.upstream;
      entry.sync.text = busy ? '$(sync~spin)' : publish ? '$(cloud-upload)' : '$(sync)';
      if (!busy && (incoming || outgoing)) entry.sync.text += ` ${incoming}↓ ${outgoing}↑`;
      entry.sync.tooltip = busy ? `${folder.name}：正在执行 Git 操作…`
        : publish ? `发布 ${folder.name} 的分支 ${branch}`
        : `同步 ${folder.name}（先拉取，再推送）\n待拉取 ${incoming}，待推送 ${outgoing}`;
      entry.sync.command = busy || !head?.name ? undefined
        : { command: 'workspaceCodex.syncRepository', title: '同步仓库', arguments: [repository.rootUri] };
      entry.sync.show();
    }
    item.show();
  };
  const refresh = () => {
    if (disposed) return;
    clear();
    const config = vscode.workspace.getConfiguration('workspaceCodex');
    updatePanel();
    if (!config.get('showRepositoryStatus', true)) return;
    const folders = vscode.workspace.workspaceFolders || [];
    if (config.get('repositoryStatusLocation', 'panel') !== 'statusBar') {
      for (const folder of folders) {
        const repository = git.getRepository(folder.uri);
        const entry = { folder, repository };
        if (repository) entry.subscription = repository.state.onDidChange(updatePanel);
        entries.set(folder.uri.toString(), entry);
      }
      if (folders.length) {
        summary = vscode.window.createStatusBarItem('workspaceCodex.openRepositories', vscode.StatusBarAlignment.Left, 9999);
        summary.name = '打开 Workspace Dock';
        summary.text = `$(repo) 工作区 ${folders.length}`;
        summary.tooltip = '打开 Workspace Dock：项目区占满面板可用宽度，排满后自动换行';
        summary.command = 'workspaceCodex.openRepositoryPanel';
        summary.show();
      }
      return;
    }
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
      const entry = { item, sync, separator, folder, repository };
      if (repository) entry.subscription = repository.state.onDidChange(() => {
        render(entry, folder, repository);
        updatePanel();
      });
      entries.set(folder.uri.toString(), entry);
      render(entry, folder, repository);
    }
  };
  listeners.push(git.onDidOpenRepository(refresh), git.onDidCloseRepository(refresh),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('workspaceCodex.showRepositoryStatus')
        || event.affectsConfiguration('workspaceCodex.repositoryStatusLocation')) refresh();
    }));
  listeners.push(vscode.commands.registerCommand('workspaceCodex.openRepositoryPanel', () =>
    vscode.commands.executeCommand('workspaceCodex.repositories.focus')));
  listeners.push(vscode.commands.registerCommand('workspaceCodex.syncRepository', async uri => {
    const repository = git.getRepository(uri);
    if (!repository || !repository.state.HEAD?.name) return;
    const key = repository.rootUri.toString();
    if (running.has(key)) return;
    const redraw = () => {
      if (disposed) return;
      updatePanel();
      for (const entry of entries.values()) {
        if (entry.item && entry.repository?.rootUri.toString() === key) render(entry, entry.folder, entry.repository);
      }
    };
    running.add(key);
    redraw();
    try {
      const command = repository.state.HEAD.upstream ? 'git.sync' : 'git.publish';
      await vscode.commands.executeCommand(command, repository.rootUri);
    } catch (error) {
      await vscode.window.showErrorMessage(`${key}：${error.message}`);
    } finally {
      running.delete(key);
      redraw();
    }
  }));
  refresh();
}

module.exports = { registerRepositoryStatus };
