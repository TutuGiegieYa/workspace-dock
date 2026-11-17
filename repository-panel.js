'use strict';
const { randomBytes } = require('node:crypto');

function registerRepositoryPanel(context, vscode, onAction) {
  let view;
  let disposed = false;
  let subscriptions = [];
  let snapshot = { enabled: true, repositories: [], message: '正在读取工作区 Git 状态…' };
  const send = () => {
    if (!disposed && view) void Promise.resolve(view.webview.postMessage({ type: 'state', ...snapshot })).catch(() => {});
  };
  const releaseView = () => {
    view = undefined;
    subscriptions.splice(0).forEach(subscription => subscription.dispose());
  };
  const provider = {
    resolveWebviewView(nextView) {
      releaseView();
      if (disposed) return;
      view = nextView;
      const webview = view.webview;
      const media = vscode.Uri.joinPath(context.extensionUri, 'media');
      webview.options = { enableScripts: true, localResourceRoots: [media] };
      const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'repository-panel.css'));
      const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'repository-panel.js'));
      const nonce = randomBytes(16).toString('hex');
      subscriptions.push(webview.onDidReceiveMessage(message => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'ready') return send();
        if (message.type === 'action' && ['checkout', 'sync'].includes(message.action)
          && typeof message.folder === 'string') {
          void Promise.resolve(onAction(message.action, message.folder)).catch(error => {
            void vscode.window.showErrorMessage(`Workspace Dock：${error.message}`);
          });
        }
      }), view.onDidChangeVisibility(send), view.onDidDispose(releaseView));
      webview.html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}"><title>Workspace Dock</title></head>
<body><main class="dock" aria-label="工作区项目">
<p id="message" role="status">正在读取工作区 Git 状态…</p>
<div id="repositories" role="list" aria-label="项目、分支和同步"></div>
</main><script nonce="${nonce}" src="${js}"></script></body></html>`;
      send();
    }
  };
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('workspaceCodex.repositories', provider),
    { dispose() { disposed = true; releaseView(); } });
  return { update(next) { snapshot = next; send(); } };
}

module.exports = { registerRepositoryPanel };
