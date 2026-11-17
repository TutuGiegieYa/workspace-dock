'use strict';
(() => {
  const vscode = acquireVsCodeApi();
  const list = document.getElementById('repositories');
  const message = document.getElementById('message');
  const icons = {
    repo: ['M3 1.5h8v11H3a1.5 1.5 0 0 1 0-3h8', 'M3 1.5a1.5 1.5 0 0 0-1.5 1.5v8'],
    folder: ['M1.5 4h4l1-1.5h6v9h-11z'],
    branch: ['M4 4v6m6-6c0 4-6 1-6 6', 'M4 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M10 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M4 10a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3'],
    sync: ['M12 6A5 5 0 0 0 3 3L1.5 4.5M1.5 1.5v3h3', 'M2 8a5 5 0 0 0 9 3l1.5-1.5M12.5 12.5v-3h-3'],
    publish: ['M7 10V2m-3 3 3-3 3 3', 'M2 9v3h10V9']
  };
  function icon(name, busy) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 14 14');
    svg.setAttribute('class', `icon${busy ? ' busy' : ''}`);
    svg.setAttribute('aria-hidden', 'true');
    for (const d of icons[name]) {
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', d); svg.append(path);
    }
    return svg;
  }
  function span(className, text) {
    const node = document.createElement('span');
    node.className = className; node.textContent = text; return node;
  }
  function actionButton(row, action, className, title) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = className; button.title = title;
    button.dataset.folder = row.folder; button.dataset.action = action;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', () => vscode.postMessage({ type: 'action', action, folder: row.folder }));
    return button;
  }
  function render(state) {
    const focused = document.activeElement;
    const focusKey = focused?.dataset.folder;
    const focusAction = focused?.dataset.action;
    const fragment = document.createDocumentFragment();
    for (const row of state.repositories || []) {
      const card = document.createElement('div'); card.className = 'repository'; card.setAttribute('role', 'listitem');
      card.setAttribute('aria-busy', String(!!row.busy));
      const title = `${row.name}\n${row.path}\n${row.hasRepository ? `分支：${row.branch}${row.dirty ? '（有未提交改动）' : ''}\n点击选择分支` : '未识别到 Git 仓库'}`;
      const project = actionButton(row, 'checkout', 'project', title);
      project.disabled = !row.hasRepository;
      project.append(icon(row.hasRepository ? 'repo' : 'folder'), span('name', row.name));
      if (row.hasRepository) {
        project.append(icon('branch'), span('branch', row.branch));
        if (row.dirty) project.append(span('dirty', '*'));
      }
      card.append(project);
      if (row.hasRepository) {
        const title = row.busy ? `${row.name}：正在执行 Git 操作…` : row.publish
          ? `发布 ${row.name} 的分支 ${row.branch}`
          : `同步 ${row.name}（先拉取，再推送）\n待拉取 ${row.behind}，待推送 ${row.ahead}`;
        const sync = actionButton(row, 'sync', 'sync', title);
        sync.disabled = row.busy || !row.canSync;
        sync.append(icon(row.publish && !row.busy ? 'publish' : 'sync', row.busy));
        if (!row.busy && (row.behind || row.ahead)) {
          const count = value => value > 99 ? '99+' : String(value);
          sync.append(span('counts', `${count(row.behind)}↓ ${count(row.ahead)}↑`));
        }
        card.append(sync);
      }
      fragment.append(card);
    }
    list.replaceChildren(fragment);
    message.textContent = state.message || '';
    message.hidden = !state.message;
    list.hidden = !state.enabled;
    if (focusKey) {
      const buttons = Array.from(list.querySelectorAll('button'));
      const target = buttons.find(button =>
        button.dataset.folder === focusKey && button.dataset.action === focusAction && !button.disabled);
      (target || buttons.find(button => button.dataset.folder === focusKey && !button.disabled))?.focus({ preventScroll: true });
    }
  }
  window.addEventListener('message', event => {
    if (event.data?.type === 'state') render(event.data);
  });
  vscode.postMessage({ type: 'ready' });
})();
