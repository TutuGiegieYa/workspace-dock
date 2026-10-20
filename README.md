# Workspace Dock

**为多项目工作区打造的 VS Code 工具：一键启动全部项目的 Codex 终端，在底部一栏看全所有项目的 Git 状态。**

## 两个核心功能

### 1. 一键启动工作区终端组

为当前工作区的每个顶层文件夹打开独立 Bash，等待各自选定的 Python 环境激活并检查成功后，并行执行 `codex resume`。项目和环境名称动态读取，无需逐个创建终端，也不需要在脚本里固定目录或 Conda 环境名。

- 支持本机 Conda 和 venv 环境；未安装 Python 扩展时可直接使用普通 Bash。
- 各项目独立初始化，就绪后立即启动，不必等待其他项目。
- 重复执行会复用已有终端，避免同一项目重复启动。
- `codex resume` 打开会话选择器，由你选择要继续的会话。

### 2. 所有项目的 Git 状态，一栏看全

在 VS Code 底部同时展示工作区内各项目名称、当前分支、未提交改动标记及独立同步按钮，用 `|` 分隔，无需反复切换当前仓库。

```text
project-api · main*  ⟳  |  project-web · feature/ui  ⟳  |  project-tools · main  ⟳
```

- 项目名称、顺序和分支信息随工作区及 Git 状态变化自动更新。
- `*` 表示有未提交改动；悬停同步按钮可查看待拉取和待推送数量。
- 点击项目/分支项，打开该仓库的分支选择器。
- 点击右侧同步按钮，调用 VS Code 的 Git 同步操作，仅作用于对应仓库。
- 尚未识别到 Git 仓库的文件夹显示项目名称，不显示同步按钮。

## 安装

当前通过 VSIX 安装，尚未发布到 VS Code Marketplace。

1. 从本仓库的 Releases 下载 `.vsix` 安装包，或按下方说明自行构建。
2. 在 VS Code 扩展面板点击右上角 **… → 从 VSIX 安装**。
3. 安装后按提示重新加载窗口。

Git 状态栏使用 VS Code 自带的 Git 扩展，无需 Codex 账号。终端组功能需要本机 Linux Bash 和已登录、可在 Bash 中运行的 Codex CLI。

如果启用了 Microsoft Python 扩展，还需要启用 **Python Environments**（`ms-python.vscode-python-envs`），并为每个文件夹选择解释器。环境激活及检查完成后才会启动 Codex，初始化失败不会继续执行。

## 使用

### 启动所有项目的 Codex 终端

打开一个多文件夹工作区，按 `Ctrl+Shift+P`，执行：

```text
Codex: 打开工作区终端组
```

也可以在“终端 → 运行任务”中选择 **Codex: 打开工作区终端组**。

### Ubuntu 自定义快捷键

在系统的自定义快捷键设置中填写以下命令：

```bash
code --open-url vscode://local-tools.workspace-codex-terminals/open
```

第一次运行可能需要确认允许此扩展打开链接。多个 VS Code 窗口打开时，链接通常交给最前面的窗口处理；VS Code 尚未运行时，会先启动编辑器。目标窗口必须已有打开的工作区文件夹。

### Git 状态栏

默认显示，无需运行 Codex。可通过以下设置关闭：

```json
{
  "workspaceCodex.showRepositoryStatus": false
}
```

同步操作沿用 VS Code 的 Git 配置和确认流程，可能拉取及推送代码；仅点击项目名称不会同步或自动切换分支。

## 支持范围和已知限制

- 批量终端功能目前面向 **本机 Linux + Bash**；Windows、macOS 和远程工作区未验证。
- Git 状态显示不依赖 Bash，但其他平台尚未实机验证。
- Git 展示以当前工作区顶层文件夹为单位，不额外平铺嵌套子模块或扫描其他目录。
- 环境发现最多等待 60 秒，超时后请确认对应文件夹的解释器选择，再重试。
- 如果终端提示 Python 扩展通过 `PYTHONSTARTUP` 贡献环境变量并要求重启，可按需关闭其 Python REPL 预览集成：`"python.terminal.shellIntegration.enabled": false`。这是 Python 扩展的设置，与 VS Code 的 `terminal.integrated.shellIntegration.enabled` 不同；后者须保留启用，以便等待 Bash 和激活命令完成。
- 当前扩展 ID 保留为 `local-tools.workspace-codex-terminals`，以兼容早期版本和系统快捷键；显示名称为 Workspace Dock。`local-tools` 是本地发布者标识，不代表已注册 Marketplace 发布者。

## 隐私

插件读取当前工作区的文件夹、所选 Python 环境和 VS Code 已加载的 Git 状态，用于本机显示和启动终端。插件自身不包含遥测、数据上传、账户凭据或作者的工作区配置。

Git 同步由 VS Code 自带 Git 功能执行，Codex 由用户本机 CLI 执行；它们分别使用用户自己的远程仓库、账号及服务配置。源码中的示例项目名称均为通用示例。

## 开发和打包

需要 Node.js（运行测试）和 Python 3（打包），无第三方运行时依赖。

```bash
npm test
npm run package
```

安装包输出到 `dist/`。打包脚本采用显式文件清单，仅包含插件代码、说明和许可证，不把测试临时文件、个人配置或开发环境打入 VSIX。

测试覆盖工作区增减、分支和改动状态更新、仓库按钮指向、并行初始化、环境就绪等待、冷启动、重复调用和取消清理。测试使用模拟 VS Code 接口，不会启动真实 Codex 会话或同步远程仓库；界面表现仍应在实际 VS Code 中验证。

## License

MIT。非 Microsoft、OpenAI 官方插件。
