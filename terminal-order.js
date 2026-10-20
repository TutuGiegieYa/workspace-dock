'use strict';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function orderFolders(folders, mode = 'workspace', custom = [], last = []) {
  const result = [...folders];
  if (mode === 'nameAscending' || mode === 'nameDescending') {
    const direction = mode === 'nameDescending' ? -1 : 1;
    return result.sort((a, b) => direction * collator.compare(a.name, b.name));
  }
  const preference = mode === 'custom' ? custom : mode === 'lastLaunch' ? last : [];
  if (!Array.isArray(preference) || !preference.length) return result;
  const rank = folder => {
    const index = preference.findIndex(key => key === folder.name || key === folder.uri.toString() || key === folder.uri.fsPath);
    return index < 0 ? Infinity : index;
  };
  return result.sort((a, b) => rank(a) - rank(b));
}

function creationQueue() {
  let previous = Promise.resolve();
  return () => {
    let release;
    const openedOrSkipped = new Promise(resolve => { release = resolve; });
    const turn = previous;
    // A later folder failing early must not overtake an earlier pending one.
    previous = previous.then(() => openedOrSkipped);
    return { turn, release };
  };
}

async function configureOrder(vscode) {
  const folders = [...(vscode.workspace.workspaceFolders || [])];
  if (!folders.length) {
    await vscode.window.showErrorMessage('当前工作区没有打开的文件夹。');
    return;
  }
  const remaining = [...folders];
  const chosen = [];
  while (remaining.length) {
    const item = await vscode.window.showQuickPick([
      ...remaining.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })),
      { label: '$(check) 保存，其余项目按工作区顺序追加', done: true }
    ], {
      title: `终端打开顺序：选择第 ${chosen.length + 1} 个项目`,
      placeHolder: chosen.length ? `已选：${chosen.map(folder => folder.name).join(' → ')}` : '依次选择；按 Esc 取消，不修改已有设置',
      ignoreFocusOut: true
    });
    if (!item) return;
    if (item.done) break;
    chosen.push(item.folder);
    remaining.splice(remaining.indexOf(item.folder), 1);
  }
  const order = [...chosen, ...remaining].map(folder =>
    folders.filter(other => other.name === folder.name).length === 1 ? folder.name : folder.uri.toString()
  );
  const config = vscode.workspace.getConfiguration('workspaceCodex');
  await config.update('customTerminalOrder', order, vscode.ConfigurationTarget.Workspace);
  await config.update('terminalOrder', 'custom', vscode.ConfigurationTarget.Workspace);
  await vscode.window.showInformationMessage('终端顺序已保存到当前工作区，下次创建终端组时生效；不会移动或关闭已有终端。');
}

module.exports = { orderFolders, creationQueue, configureOrder };
