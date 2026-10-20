# Workspace Dock

**为多项目工作区打造的 VS Code 工具：一键启动全部项目的 Codex 终端，在底部一栏看全所有项目的 Git 状态。**

## 两个核心功能

### 1. 一键启动工作区终端组

为当前工作区的每个顶层文件夹打开独立 Bash，等待各自选定的 Python 环境激活并检查成功后，并行执行 `codex resume`。项目和环境名称动态读取，无需逐个创建终端，也不需要在脚本里固定目录或 Conda 环境名。

- 支持本机 Conda 和 venv 环境；未安装 Python 扩展时可直接使用普通 Bash。
- 终端按选定顺序创建；各项目环境发现并行进行，标签创建后独立激活环境并启动 Codex，不等待前一项目完成激活或退出。
- 重复执行会复用已有终端，避免同一项目重复启动。
- `codex resume` 打开会话选择器，由你选择要继续的会话。
- 终端标签显示 `Codex: 会话名称: 项目名`：进入选择器或新会话尚未命名时显示 `未选择会话`，首轮对话生成名称后自动更新，用户改名、切换会话或清空名称时继续跟随更新。
- 名称直接来自 Codex CLI 的 `thread-name` 终端标题输出，不扫描聊天记录、不读取会话数据库，也不根据“最近一次会话”猜测。标题长短及刷新时机以 CLI 实际输出为准。

### 2. 所有项目的 Git 状态，一栏看全

在 VS Code 底部同时展示工作区内各项目名称、当前分支、未提交改动标记及独立同步按钮，用 `|` 分隔，无需反复切换当前仓库。

```text
project-api · main*  ⟳  |  project-web · feature/ui  ⟳  |  project-tools · main  ⟳
```

- 项目名称、顺序和分支信息随工作区及 Git 状态变化自动更新。
- `*` 表示有未提交改动；悬停同步按钮可查看待拉取和待推送数量。
- 有待同步提交时，按钮旁显示数量，例如 `3↓ 2↑`；没有上游分支时，显示发布图标。
- 点击项目/分支项，打开该仓库的分支选择器。
- 点击右侧同步按钮，调用 VS Code 的 Git 同步操作，仅作用于对应仓库。
- 本插件按钮触发的同步/发布操作执行期间，图标旋转并暂时禁用重复点击；命令完成、取消或失败后恢复。拉取/推送失败保留 VS Code 原生错误通知，传到插件的异常也会提示。
- 尚未识别到 Git 仓库的文件夹显示项目名称，不显示同步按钮。

## 安装

当前通过 VSIX 安装，尚未发布到 VS Code Marketplace。

1. 从本仓库的 Releases 下载 `.vsix` 安装包，或按下方说明自行构建。
2. 在 VS Code 扩展面板点击右上角 **… → 从 VSIX 安装**。
3. 安装后按提示重新加载窗口。

Git 状态栏使用 VS Code 自带的 Git 扩展，无需 Codex 账号。终端组功能需要本机 Linux Bash、Python 3 和已登录、可在 Bash 中运行的 Codex CLI。动态会话标题针对 CLI 0.163.0 验证，需要 CLI 支持 `tui.terminal_title` 的 `thread-name` 条目。

如果启用了 Microsoft Python 扩展，还需要启用 **Python Environments**（`ms-python.vscode-python-envs`），并为每个文件夹选择解释器。环境激活及检查完成后才会启动 Codex，初始化失败不会继续执行。

## 使用

### 启动所有项目的 Codex 终端

打开一个多文件夹工作区，按 `Ctrl+Shift+P`，执行：

```text
Codex: 打开工作区终端组
```

也可以在“终端 → 运行任务”中选择 **Codex: 打开工作区终端组**。

### 自定义 Bash 打开顺序

在 VS Code 设置中搜索 **Workspace Dock**，配置 **Terminal Order**：

| 值 | 行为 |
| --- | --- |
| `workspace`（默认） | 按资源管理器中顶层工作区文件夹的顺序打开。 |
| `nameAscending` | 项目名称自然升序，例如 `project-2` 排在 `project-10` 前。 |
| `nameDescending` | 项目名称自然降序。 |
| `custom` | 按 **Custom Terminal Order** 列表打开；未列出的新项目追加在后。 |
| `lastLaunch` | 使用当前工作区上一次成功启动的项目顺序；无记录时使用工作区顺序。 |

也可以运行命令 **Workspace Dock: 设置终端打开顺序**，按先后点击项目，结果会保存到当前工作区的设置。

```json
{
  "workspaceCodex.terminalOrder": "custom",
  "workspaceCodex.customTerminalOrder": [
    "project-web",
    "project-api",
    "project-tools"
  ]
}
```

列表支持工作区文件夹名称、完整路径或文件夹 URI；同名文件夹请使用路径或 URI。设置可以保存在用户级或工作区级，工作区配置优先。删除的项目会忽略，新加入的项目不需要修改任务文件。

`lastLaunch` 记住的是插件上次成功启动时的项目顺序，**不是用户拖拽标签后的排列**：VS Code 稳定扩展 API 不提供终端列表拖拽排序事件。自定义顺序会稳定约束新标签的创建位置，不会因为后面的项目更早完成环境发现而抢到前面；因此前一个项目的环境发现尚未完成时，后面标签可能需要等待它的创建位置。创建后各项目激活和 Codex 运行仍然并行。

这些设置只影响新建终端，重复执行不会搬动、关闭或重启已有终端。升级后若要应用新顺序，请先正常结束已有 Codex 并关闭对应标签，再创建终端组。

### 后台生命周期和会话占用

默认设置为 `"workspaceCodex.useSharedCodexBackend": false`，以 `codex resume --no-daemon` 使用独立后台。会话写入锁跟随该次 CLI 进程的生命周期；CLI 完全退出时由操作系统释放，而不是留在常驻共享服务中。

需要复用后台资源时，可以在设置中启用 **Use Shared Codex Backend**。代价是 Bash/前台窗口关闭后，共享服务仍可能保留已加载的会话和写入锁；关闭终端不等于共享后台立即释放会话。独立模式可能比共享模式使用更多后台资源。切换只影响之后新启动的 Codex，不会自动释放旧后台已经持有的锁。

插件不删除锁文件、不自动归档聊天，也不终止其他会话来抢占写入权。会话占用应先确认持有者后再处理；退出 Codex 或关闭 Bash不会删除会话历史。

### Ubuntu 自定义快捷键

在系统的自定义快捷键设置中填写以下命令：

```bash
code --open-url vscode://local-tools.workspace-codex-terminals/open
```

第一次运行可能需要确认允许此扩展打开链接。多个 VS Code 窗口打开时，链接通常交给最前面的窗口处理；VS Code 尚未运行时，会先启动编辑器。目标窗口必须已有打开的工作区文件夹。

如果你的 Dock 启动项包含输入法变量或 `--ozone-platform` 等显示后端参数，自定义快捷键也应沿用它们，再加上 `--open-url` 和链接，以免两种启动方式的输入法表现不同。

### 动态会话标签

扩展默认把 `terminal.integrated.tabs.title` 设为 `${sequence}`，让未固定名称的终端接受程序发出的标题；用户已有的显式设置优先。若你配置过该项，需要自行改为 `${sequence}` 才能显示动态标题。手动重命名、已有固定名称的终端不会被强行改写，新功能用于本版本新创建的终端。

```text
选择器 / 新会话无名称 → Codex: 未选择会话: project-api
首轮自动命名       → Codex: 修复登录问题: project-api
用户修改名称       → Codex: 登录流程重构: project-api
Codex 退出         → 回到 Bash，标签随后可由 Bash 提示符更新
```

标题转接器以标准库 PTY 保持交互输入、窗口缩放和退出状态，只格式化 OSC 0/2 标题序列；不保存输出，也不读取认证文件。该次启动通过命令行覆盖 CLI 标题条目，不修改用户的 Codex 全局配置。启动后请保留 `thread-name` 标题条目；若在 CLI 内用 `/title` 换成其他条目，标签也会反映那些输出。

相关配置见 [Codex 官方配置参考](https://developers.openai.com/codex/config-reference/)。

### Git 状态栏

默认显示，无需运行 Codex。可通过以下设置关闭：

```json
{
  "workspaceCodex.showRepositoryStatus": false
}
```

同步操作沿用 VS Code 的 Git 配置和确认流程，可能拉取及推送代码；仅点击项目名称不会同步或自动切换分支。

按钮动画跟踪的是从本插件按钮启动的命令生命周期；从其他入口执行的 Git 操作没有稳定公开的操作状态事件，暂不保证同步显示旋转动画。分支和提交数量仍通过原生 Git 状态事件更新。

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

需要 Node.js（运行测试）和 Python 3（标题转接与打包），无第三方库依赖。

```bash
npm test
npm run package
```

安装包输出到 `dist/`。打包脚本采用显式文件清单，仅包含插件代码、说明和许可证，不把测试临时文件、个人配置或开发环境打入 VSIX。

GitHub Actions 会对提交和 PR 运行检查；维护者推送与 `package.json` 版本一致的 `v*` 标签后，检查通过才会创建 Release 并上传 VSIX。发布使用该仓库的临时 `GITHUB_TOKEN`，无需在源码或仓库 Secrets 中保存个人访问令牌。

测试覆盖工作区增减、分支和改动状态更新、仓库按钮指向、同步过程及失败清理、并行初始化、环境就绪等待、冷启动、重复调用和取消清理。标题测试使用真实 PTY 和模拟 CLI 验证分段 Unicode 标题、命名/改名/清空、输入、窗口缩放、退出码和终端模式恢复。测试不会启动真实 Codex 会话或同步远程仓库；界面表现仍应在实际 VS Code 中验证。

## License

MIT。非 Microsoft、OpenAI 官方插件。
