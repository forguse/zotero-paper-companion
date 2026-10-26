# 安装更新与服务接入

核对日期：2026-10-25。

## GitHub 分发能否自动更新

可以。Zotero 根据插件的 `update_url` 检查 JSON 更新清单，再下载清单中的新 XPI；更新清单需要保持相同插件 ID，并提供版本、兼容范围与下载链接。这是 [Zotero 官方支持的插件更新机制](https://www.zotero.org/support/dev/zotero_7_for_developers#updaterdf_updatesjson)。

GitHub 可以托管源码、更新清单与 Release 安装包。公开下载需要一个无需登录即可访问的更新清单和 XPI 地址；普通用户无法凭私有仓库的网页链接自动取得受限附件。不要把个人 GitHub Token 写入插件。

Zotero 要求插件清单包含 `update_url`，缺少该字段会拒绝安装。当前地址已指向本仓库最新版 Release 的 [`updates.json`](https://github.com/forguse/zotero-paper-companion/releases/latest/download/updates.json)。清单与其中的 XPI 地址都可在未登录状态下下载时，可使用正常的 Zotero 更新机制，无需为公开仓库另改插件地址。仓库可见性改变后仍需实际核对下载与更新，不能只凭“公开”状态视为验收通过。

1. 构建新 XPI 并完成验证。
2. 将 XPI 上传到相应版本的 GitHub Release。
3. 运行 `python scripts/make_update_manifest.py`，生成包含安装包 SHA-256 的 `dist/updates.json`。
4. 将 `updates.json` 和 XPI 作为同一 Release 的附件发布，再核对未登录下载及文件校验和。若改用独立下载站，才需更改 `update_url`，并让使用者先安装配置好新地址的版本。
5. 后续发布保持插件 ID 不变，并在安装包可下载后更新清单。

这不会让运行中的任意源码修改立即生效。Zotero 的引导式插件有启动/停用生命周期，可在受支持的环境中重载，但版本兼容性、阅读器和网页状态仍可能影响更新后的行为；发布时应实际验证。用户遇到旧界面时可重启 Zotero。不要通过远程下载并执行脚本替代正常的 XPI 更新。

### 维护者发布流程

更新清单只指向一个已验证的安装包。保持 `paper-companion@local` 不变，同步 `addon/manifest.json` 与 `package.json` 的版本后，先运行：

```sh
node --test tests/*.test.cjs
python -m unittest discover -s tests -p 'test_*.py'
python scripts/check_repository.py
python scripts/build.py
python scripts/make_update_manifest.py --tag v版本号
```

最后一个命令中的 `v版本号` 需替换成实际版本，例如 `v1.0.0`。不传参数仍按当前版本生成 `dist/updates.json`，兼容原有本地构建流程。脚本会检查源文件、XPI 内的版本与插件身份、Zotero 兼容范围、固定安装包与版本包的一致性，再计算准确的 SHA-256；版本或标签不匹配时停止。`--repository OWNER/REPO` 可用于派生仓库；`--download-url https://…/plugin.xpi` 可使用独立下载站。地址必须是 HTTPS，不允许账号密码、查询参数中的令牌、片段或自定义端口。

完成隔离 Zotero 的安装、完整重启和本轮受影响功能验证后，将 **`INSTALL-LATEST.xpi`、`updates.json` 与校验和**作为同一 Release 的附件上传。先检查附件能下载且哈希相符，再发布这份清单；不要把旧版本标签改指向新包。

仓库提供手动触发的 **Prepare verified release draft** 工作流。推送已验证的版本标签后，在 GitHub Actions 填入该标签。它运行核心检查、构建、清单校验，只创建或更新该标签的**草稿 Release**，遇到已经公开的同名 Release 会停止，避免覆盖现有用户的安装包。工作流不改变仓库可见性；只在运行中使用 GitHub 提供的临时权限，安装包内不包含令牌。它不能代替原生 Zotero 的功能与重启验收，也不会自行发布草稿。

**下载源需要权限时，应使用手动安装，或另外提供公开下载服务。** 私有 Release 的附件需要访问权限，Zotero 的普通更新检查不会借用你浏览器里的 GitHub 登录。不得为解决下载问题把维护者令牌写入插件。启用自动更新前，必须确认清单和 XPI 都能在未登录状态下下载；仅设置一个受限的 GitHub 地址不能完成自动更新。[GitHub 附件访问说明](https://docs.github.com/en/rest/releases/assets#get-a-release-asset)说明，未认证访问适用于公开资源。源码仓库与下载服务可以分别选择访问权限。

本地生成脚本不会联网、上传文件、公开仓库或发布 Release。GitHub 上的最新版安装包与当前本机开发版可能不同。

## 插件管理器里没有论文伴读

先打开「工具 → 插件」检查是否列出论文伴读。如果没有列出，需通过齿轮菜单「从文件安装插件」，选择 `INSTALL-LATEST.xpi`，完成安装提示，并确认列表里出现对应版本。安装包无需解压。之后完整退出、重新打开 Zotero，再确认插件仍在列表且侧栏可以打开。

插件安装、设置和论文 Markdown 分开保存；本插件保持相同 ID，重新安装会继续读取已有设置和资料。恢复安装不需要重置 Zotero 配置或删除数据目录。

管理器缺项与“插件仍在列表但侧栏为空”应分别排查。前者需要核实当前配置的 XPI 与安装登记；后者应检查启动错误和资源加载。仅凭空白画面不能认定资料丢失，也不能确定插件被移除的具体原因。

## 预读、检索与模型上下文

预读入口显示当前论文的本机状态：未准备、已提取、已预读或需更新。重新打开或回到面板时只核对已保存资料和 PDF 标识，不提取整篇、不连接模型；阅读器尚未就绪时短暂重试，仍无法核对则保留待核对状态。PDF 大小、修改时间或阅读器标识变化会使旧提要失效，已有文件仍可查阅。

「模型预读」会主动向当前问答引擎发送整篇可提取的文字，长文分段处理，再整理成 `论文预读.md`。完成的分段保留进度；同一 PDF、同一模型配置可继续。已有有效提要时复用不再调用模型；「重新预读」才重新消耗用量。图表图片和无文字的扫描页没有由这个文字预读过程识别。

后续智能问答重新提供这份精简提要，并根据问题检索有界原文片段；不会把全文作为旧材料反复回放。提要是模型生成的笔记，可能有误，具体结论应核对引用原文。PDF 变化后旧提要不再自动使用，需重新预读。这种方式不依赖模型永久记忆，也不承诺零 Token。

DeepSeek 的普通对话仍由请求中的消息提供上下文；服务端缓存影响计费，不能代替提供上下文。ChatGPT 授权请求当前使用不存储的 Responses 调用，也不假设账号支持服务器永久保存全文。

ChatGPT 网页使用「传入预读草稿」，由用户点击网站发送。只有当前页面出现匹配的完整问答后才确认网页已处理预读；草稿、生成中和新网站对话不会当作已有上下文。网站历史是否仍在模型上下文窗口内最终由网站管理。

## 用量与费用来源

输入区下方可展开今日、本篇和累计记录。只记录安装此功能之后本机插件实际发出的模型调用，不回填未知历史；数值来自服务返回的用量。未返回的用量标为未知，思考 Token 不在输出之外重复相加。费用以调用当时的单价快照估算，币种分开，不代表含税账单。

默认的小入口优先显示金额，Token 留在悬停提示和展开明细。DeepSeek 默认人民币，ChatGPT 授权默认显示「等效 US$…」；自定义单价的币种和历史快照保留，各币种不换算、不混加。部分调用未计价时显示「＋待计价」，全部未知时不会显示为 0 元。

「查套餐额度」按 [OpenAI 官方账号与用量指引](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#tracking-usage)打开 [ChatGPT 用量页](https://chatgpt.com/settings/usage)，不会发送模型请求或读取其他应用的登录凭据。当前插件的 Sign in with ChatGPT 直连授权没有已验证的套餐余量读取能力，因此插件内不显示剩余百分比。官方另为 [Codex App Server](https://learn.chatgpt.com/docs/app-server)提供 `account/rateLimits/read`，但这是另一套本地服务接口，不能直接当作当前授权可调用的 HTTP 端点，也不能用 Codex 桌面账号代替插件选中的账号。

限制周期和重置时间以官方页的账号、工作区和适用套餐为准，不固定称为“月额度”。按当前[套餐规则](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#tracking-usage)，Plus 的五小时用量由各应用共享，Pro 不适用这一五小时限制。API 等效金额不能换算为套餐剩余比例；普通网页 Chat 的限制仍以网页提示为准。核对于 2026-10-25。

- [DeepSeek 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)：默认按空闲至高峰显示费用区间，避免错误猜测节假日。
- [OpenAI 价格](https://developers.openai.com/api/docs/pricing)：ChatGPT 授权显示 API 等价估算，不能当作 ChatGPT 套餐扣款。[套餐授权的用量规则](https://developers.openai.com/siwc/token-sharing-open-source)另由官方决定。
- [DeepSeek 余额接口](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)：点击「查询余额」才请求；更改 API Key 后旧缓存失效。

普通 ChatGPT 网页不提供插件可读取的官方 Token 或账单，因此显示「未提供」，不能算作免费。未知模型可填写自定义单价，仅影响未来调用。统计文件保存在本机插件配置目录，只含用量数字、模型和功能等元数据，不保存问题、论文正文或凭据。

问答推理强度按模型目录或已核对的[官方模型能力](https://developers.openai.com/api/docs/guides/reasoning)提供选项。未知能力仅用模型默认；不支持的已存选择会明确报错，不自动降低强度或换模型。
