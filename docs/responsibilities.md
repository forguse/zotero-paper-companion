# 服务端口与扩展示例

本文对应 1.0 系列。整体模块地图见[架构说明](architecture.md)，安装、测试与打包见[开发指南](../CONTRIBUTING.md)。服务只接收所需能力，不应再把完整平台单例传入新模块。

## 模型网关

`PCModelGateway` 构造器接收四个函数：

| 端口 | 输入与返回 | 约束 |
| --- | --- | --- |
| `connection()` | `{ state, active, epoch, models, closing }` | 仅读取本机状态；模型目录含能力元信息 |
| `readDeepseekKey()` | `Promise<string>` | 由平台读取已加密凭据，不暴露给视图 |
| `accessToken(account, signal)` | `Promise<string>` | 只为明确发起的操作取得对应账号令牌 |
| `request(url, options, meta)` | 响应或流式请求 Promise | 必须经过统一计量，meta 包含提供方、功能、论文键 |

典型调用：

```js
const selection = gateway.snapshot({
  provider: 'deepseek', model: 'deepseek-flash', effort: 'none'
});
// 可以在本机准备图片、原文；快照不应写入论文文件。
const result = await gateway.generate({
  selection, instructions: '提炼输入材料中的核心论点。',
  text: selectedText, signal, usageFeature: 'summary', usageKey: paperKey
});
```

`snapshot()` 不连网，固定账号、连接代次和模型元信息。`available()` 验证当前选择与本机 Key 状态，不自动连接 ChatGPT。`open(selection, signal)` 返回封闭通道，令牌留在内部，通道不能用于切换提供方或账号。

连续问答使用 `channel.prepare(options)`。它同步完成材料校验并捕获一次请求正文，返回 `{ notice, run }`；`run({ onDelta, onModel, usageFeature, usageKey })` 返回同一个完成 Promise，重复调用不会重复付费。问答服务在校验成功后才追加待回复消息。`onModel` 只接收服务实际返回的非空模型名；没有返回时保留请求模型，不推测其他模型。

Responses/DeepSeek 的纯构造和流解析继续在 `core.js`。网关统一协议分支、鉴权、强度检查和计量端口；新增模型提供方还需要配置、能力和计价规则，不能只增加一个 URL。

## 问答服务

`PCChatService` 不访问 DOM、Zotero、磁盘路径或凭据，端口分为：

- 状态与模型：`runtime`、`snapshotModel`、`openModel`。
- 资料与持久化：`session`、`prepare`、`save`、`cite`。
- 完成后行为：`record`、`organize`、`verified`、`emit`。

服务拥有 `busy`、`controller` 和 `completion`。在第一次读取会话前登记任务；`stop()` 覆盖准备与模型请求，`drain()` 等待本机保存完成。平台原有 `ask()`、忙碌查询和停止入口保留为兼容桥接；新代码应通过服务操作，不直接修改内部状态。

配置、账号和阅读论文列表在异步操作前固定。初始和会话加载完成后都检查关闭、历史切换及预读冲突；新建/恢复不能越过忙碌保护。不完整回答不会进入后续有效上下文；保存失败仍保留可见回答及仅重试保存入口。自动笔记或重点整理失败作为独立通知，不修改已经完成的问答状态。

## 设置控制器

`PCSettingsPanel` 接收 `document` 和明确的偏好/视图端口：`readSettings`、`saveSettings`、`keyPresent`、`readPrompt`、`defaultPrompt`、`readVocabularyState`，以及保存后刷新和通知回调。`keyPresent` 只返回布尔值；控制器不接收账号列表、令牌或完整 API。

控制器拥有脏字段、双提示词和词库设置草稿，统一绑定和解绑事件。保存前捕获提交值，只有仍等于提交值的控件才清除脏状态；保存期间继续输入保留为新草稿。Key 留空代表保留，仅明确删除操作清除。失败保留输入，过期异步检查不覆盖较新状态，销毁后不再操作视图。

这次拆分覆盖批量设置与草稿事务；账号操作、各功能即时选项、资料文件夹迁移和视图状态仍由平台及页面组合层协调。无需为减少行数把它们机械搬入另一个大控制器。

## 存储服务

### 阅读范围、摘记与操作指南

`reading-scope.js` 只根据已知状态生成计划或实际依据；不读取 PDF、不连接模型。问答服务与网页草稿准备共用它的材料选择规则；`reading-scope-ui.js` 只展示缓存状态和显式本篇选项。

`note-insertions.js` 保存有界的本次运行内撤销记录；只允许精确确认的插入区间撤销，保留后续追加。`note-receipt-ui.js` 通过本机写入、刷新、定位端口展示回执，不操作文件路径。直接编辑器按源 Markdown 区间定位，只滚动自身。

`action-guide.js` 管理可关闭的提示和最多两个固定入口；只在用户点击具体动作时调用注入回调。启动与偏好保存不会发起推理。

### 经确认的卸载清理

`uninstall-service.js` 将只读清单与显式执行分开。清单确认票固定具体路径、类别、元信息和内容校验值；执行需要票号、确认文字和明确同意。服务只通过单文件删除端口处理所选清单，最后调用卸载端口；不支持递归目录删除。

`native.js` 提供平台路径保护、流式哈希、附件保护、写入屏障和 AddonManager 适配。清理前同步关闭新动作并排空正在保存的内容；部分失败保留锁定，防止自动保存重建已清理文件。`uninstall-ui.js` 展示清单、类别和确认，长清单保留固定关闭入口及确认区进度。未知文件、原始附件、空目录和未登记旧导出保留，范围见[卸载说明](uninstall.md)。

`sessions.js` 与 `usage-store.js` 均注入读写端口并可直接测试。会话保持可变对象身份和未保存内容；用量历史采用不可变分段和有界明细缓存。底层文本替换通过 `PCKeyedQueue` 按目标路径排队，业务读改写另有事务，不能混淆。

外部兼容方法 `insights.generate/credentials` 只转发到网关；公式、翻译、预读、词义与 OCR 的生产路径直接使用网关。新的通用模型功能不得依赖重点服务。

## 检查清单

- [x] 模型网关独立，生产推理统一计量。
- [x] 问答编排独立，取消和等待覆盖首次异步准备及保存收尾。
- [x] 设置草稿、Key 状态与并发保存有独立控制器。
- [x] 新模块直接导入测试，覆盖模型快照、账号变化、材料校验、保存故障和较新草稿保护。
- [x] 原文有界缓存与共享提取，用量分段迁移和历史分页。
- [x] 阅读范围、可撤销摘记、操作指南和卸载清理分别有独立服务及界面控制器。
- [x] 1.0.0 核心、构建、原生安装升级与清理检查共 869 项通过；功能代码沿用完成 2116 项原生回归的稳定基线，详见[交付验证](release-quality.md)。

未包含的工作有：全界面控制器拆分、可变会话自动释放、跨进程协同编辑，以及当前授权方式未验证的套餐余量读取。它们应保持明确边界，不能由一次重构或主观评分推定完成。
