# 参与开发

论文伴读是原生 Zotero 插件，使用 XHTML、CSS 与 JavaScript，无需前端框架或 npm 依赖。开始前请阅读[架构与扩展约定](docs/architecture.md)及[模块职责方案](docs/responsibilities.md)，确认所改功能的状态、存储和生命周期归属。

## 本地构建

需要 Python 3；核心测试另需 Node.js。克隆仓库后在项目根目录执行：

```sh
node --test tests/*.test.cjs
python -m unittest discover -s tests -p 'test_*.py'
python scripts/check_repository.py
python scripts/build.py
```

Windows 也可运行 `BUILD.cmd`。构建会检查版本一致性和运行文件白名单，生成根目录固定的 `INSTALL-LATEST.xpi` 及 `dist/` 下的版本包。XPI 通过 GitHub Releases 分发，不纳入源码提交。可在 Zotero 插件管理器中选择「从文件安装插件」安装自己的构建。

## 从哪里开始

| 目录或文件 | 用途 |
| --- | --- |
| `addon/bootstrap.js` | 插件启动、关闭与模块加载顺序 |
| `addon/content/native.js` | Zotero 平台适配与服务组合，保留兼容入口 |
| `addon/content/model-gateway.js` | 模型/账号快照、凭据端口、协议与统一计量请求 |
| `addon/content/chat-service.js` | 问答准备、忙碌/停止/完成、引用与保存收尾 |
| `addon/content/settings-panel.js` | 批量设置、提示词与词库选项草稿、Key 状态和保存互斥 |
| `addon/content/reading.js` | 原文索引、有容量边界的缓存、共享提取与独立取消 |
| `addon/content/usage-store.js` | 近期记录、历史分段、汇总和分页，不访问模型或界面 |
| `addon/content/sessions.js` / `persistence.js` | 会话归档恢复与按目标路径的写入队列 |
| `addon/content/panel.js` 与其他界面模块 | 页面组合、特定功能的交互和展示 |
| `addon/locale/` | 本地化资源 |
| `tests/*.test.cjs` | 无真实账号的核心与模块测试 |
| `tests/*-native-harness.js` | 在 Zotero 中运行的隔离集成检查 |
| `scripts/build.py` | XPI 打包白名单与版本一致性检查 |
| `scripts/check_repository.py` | 排除凭据、用户资料和生成文件的提交检查 |
| `docs/usage.md` | 面向使用者的操作说明 |

模型网关、问答服务、设置控制器和用量存储可直接导入 Node 测试，通过注入端口验证。批量设置已拆分；模型选择等即时偏好、账号展示、资料位置与其他功能视图仍有部分逻辑留在 `panel.js`，不应把本轮拆分称为整个面板已解耦。布局和外观的稳定约束分别见[交互规格](docs/chat-reading.md)及[主题规范](docs/appearance.md)。

新增运行文件时，同时登记对应的加载入口和 `scripts/build.py` 白名单。保持 `package.json` 与 `addon/manifest.json` 版本一致；不要通过全目录打包让辅助文件进入 XPI。

## 行为兼容

- 保持插件 ID、每篇论文的数据键与文件格式兼容；需要迁移时给出可恢复路径。
- 原生右侧栏、划词浮窗、笔记直接编辑及自动保存必须保留，不增加段落编辑模式。
- 打开 Zotero、侧栏或切换主题不发起模型连接；每次操作固定明确的模型与账号，不静默换提供方或模型。
- 普通 ChatGPT 网页模式只填写草稿和附加材料，由用户点击网站发送。授权模式的套餐信息不能视为普通 Chat 可用额度。
- 不覆盖外部修改的个人资料而不保留备份；失败或取消应保留已有内容，并支持明确的重试。
- 动效应尊重减少动态效果及高对比度，不能遮住菜单、选区和输入。

## 原生集成验证

核心测试通过后，按改动运行对应的 Zotero 检查。共享 PDF 提取需验证一个调用者取消不影响其他调用者、全部取消后底层停止，以及来源变化不写入旧索引；缓存容量是估算保留数据的预算，不是对 JavaScript 堆内存的承诺。用量分段需验证旧文件读取、迁移写失败可重试、汇总与分页一致，不能通过丢弃历史减小文件。`scripts/smoke_zotero.py` 另需 Python 的 `reportlab`，用于生成合成 PDF；每轮指定一个新建的专用目录：

```sh
python scripts/smoke_zotero.py .native-tests/my-reading-check --reading
```

脚本输出配置路径后，用 Zotero 的 `-no-remote -profile <输出的配置路径>` 启动该隔离配置。检查目录中的 `result.json`，不能只根据启动成功判断通过。不要使用日常 Zotero 配置、真实论文、真实 Key 或登录令牌作为夹具。

| 改动范围 | 常用检查选项 |
| --- | --- |
| 原文提取、检索、预读 | `--reading`、`--preread` |
| 问答状态、布局与阅读位置 | `--iteration`、`--chat-layout`、`--chat-interactions` |
| 笔记、公式、重点 | `--notes`、`--formula`、`--insights` |
| 单词本与独立窗口 | `--vocabulary`、`--vocabulary-window` |
| 设置、存储、网页及费用 | `--workspace`、`--storage`、`--web`、`--usage` |
| 全页面、缩放、四主题及追光 | `--uiux`、`--polish`、`--four-themes`、`--native-appearance`、`--edge-light` |
| 安装持久化与完整重启 | `--install-restart` |
| 阅读范围、摘记回执、分组保存与操作指南 | `--experience` |
| 确认后清理、卸载及同配置重启和重装 | `--uninstall-cleanup` |

无专项选项时运行完整功能集成检查。`--clear-restart` 的第二次启动需报告 `phase: complete`；`--install-restart` 需完成安装和同配置的第二进程启动，分别核对 `install-result.json`、`restart-result.json`。它们都需要真正退出首个 Zotero 进程，不能以关闭、重开一个窗口代替。

`--uninstall-cleanup` 只可用于新建的专用测试目录。它会实际删除该隔离配置中生成的合成插件文件，移除测试插件；第二次启动同一配置先检查没有重建，再通过 AddonManager 重装并确认账号、Key、词库和笔记处于新配置状态。核对 `uninstall-result.json` 与 `restart-result.json`；两次启动之间不要再次运行准备脚本，否则会提前重装插件。原始合成 PDF、文献和未知测试文件必须保持不变。

模型、余额和网页检查使用模拟响应及本地网页替身；通过结果不代表真实账号在线服务验证。UI 截图必须来自实际构建和合成资料，注明环境与限制。`scripts/capture_showcase.py --layout` 可辅助捕获界面；输出保存在忽略的 `.native-tests/` 内。光效模块规则见[边框光效说明](docs/edge-light.md)。

## 提交与发布

提交源码、必要测试、使用说明和第三方许可。请勿提交 API Key、账号配置、真实论文、个人笔记、测试配置、生成报告、依赖缓存或 XPI。仓库检查通过后仍应检查差异，尤其是新增图片和示例资料。

提交描述应说明用户遇到的问题、最终行为和验证范围。新功能同步更新使用指南，版本变化写入 `CHANGELOG.md`；不要把个人操作记录或中间调试日志写入 README。

发布前核对最终被测 XPI 与根目录固定安装包及版本包一致。更新清单和 GitHub Release 的配置方式见[安装更新说明](docs/updates.md)。发布或变更仓库可见性，应分别获得仓库维护者授权。
