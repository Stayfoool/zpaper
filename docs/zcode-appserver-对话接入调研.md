# ZCode app-server 对话接入调研（2026-10-07）

> 背景：给 zpaper 加「AI 对话窗口」时，验证过最彻底的 ZCode 化方案——直接驱动
> ZCode 自带的 `app-server`（ZCode Protocol stdio 服务，桌面端同款后端）。
> 传输层与会话层**全部打通**，最终卡在独立 CLI 的模型账号层；结论与复现路径存档于此，
> 待条件满足可按第四节直接落地切换。

## 一、结论速览

| 事项 | 结果 |
|---|---|
| app-server 传输格式 | ✅ 按行分隔 JSON：请求 `{id, method, params}` → 响应 `{id, result}`；通知/事件无 `id` |
| V4 握手（hello/clientHello） | ✅ legacy 方法面**不需要**（`runtime/capabilities` 裸调即通） |
| 会话生命周期 | ✅ `session/create` → `session/subscribe` → `session/send` → 事件流 → `session/close` |
| 反向请求 | ✅ 需应答 `session/requestRuntimePreferences`（否则 15s 超时、turn 失败） |
| 事件词汇 | ✅ `turn.*` / `message.upserted` / `part.delta` / `tool.updated` / `permission.requested` / `state.updated` 等 |
| **模型解析** | ❌ 独立 CLI 的 Provider Registry 为空（`model.available: []`），任何 `modelSelection` 都报 `provider_not_found` |

## 二、已验证的协议事实（zcode 0.16.9）

1. **启动**：`zcode.cjs app-server --stdio`（打包 bundle 以 `ELECTRON_RUN_AS_NODE=1` 运行）。
   启动即推送 `startup/storageState` 通知（数据库就绪），无需应答。
2. **建会话**：
   ```json
   {"id":1,"method":"session/create","params":{
     "workspace":{"workspacePath":"<dir>","workspaceKey":"<dir>"},
     "mode":"plan",                // plan|build|edit|yolo|auto
     "persistence":"immediate"     // 仅 immediate|deferred，无 "ephemeral"
   }}
   ```
   返回 `{session:{sessionId}, projection, protocol, runtime}`。
3. **订阅**：`session/subscribe` `{sessionId, deliveryKind:"desktop-continuous", includeSnapshot:true}`
   → 返回全量快照（messages/projection/todos/settings…）+ `eventSeq`。
4. **发送**：`session/send` `{sessionId, content, modelSelection?{providerId,modelId}}`
   → `{accepted:true, stateRevision}`；随后事件以通知形式推送。
5. **反向请求**（服务端 → 宿主，带 `id`，必须回 `{id, result}`）：
   - `session/requestRuntimePreferences` →
     `{nativeSearchEnhancementsEnabled:true, memoryEnabled:false, askUserQuestionAutoResolutionEnabled:true}`
   - `interaction/requestPermission` → `{decision:"deny", reason}`（plan 模式基本不会出现）
   - `interaction/requestUserInput` → `{cancelled:true}`
6. **流式正文**：`part.delta` 事件 `payload.delta` 拼接即助手文本；`turn.completed`/`turn.failed` 收尾。

## 三、为什么模型层走不通（本机实测）

- `zcode -p "hi" --mode plan` **同样报 `Model creation failed`**——不是 app-server 特有问题，
  而是独立 CLI 从未建立可用模型账号（桌面端的登录态只活在桌面进程注入的 env 里）。
- Provider 配置三层：builtin（app 包 `Resources/config/provider/zcode-builtin.json`）、
  personal（`~/.zcode/v2/provider_config.json`）、account（OAuth 登录物化）。
  本机 personal 层只有 `account:zai-start-plan` 规则——account provider 需要登录态才物化，
  而登录态缺失 → Registry 为空。
- 实测尝试过：`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` + `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`
  env 覆盖（指向自带 builtin + 自写 personal 规则）→ **env 在 app-server 模式下未生效**；
  向默认 `provider_config.json` 合并普通 api-key provider 规则 → 仍未出现在 Registry
  （可能还需 template/materialize 链路，未继续深挖）。
- **出路**：`zcode login`（CLI OAuth 登录一次）后，account provider 物化，整条链路即应可用。

## 四、切换路径（当 CLI 登录可用时）

1. 把 /tmp 探针脚本重写为主进程常驻客户端（spawn + 按行 JSON + 反向请求应答器），约 200 行；
2. `session/create` 用 `mode:"plan"`（对话只读，符合「ZCode 负责读和想」的分工）；
3. `session/send` 每轮注入文档 markdown（`content` 前缀或 `attachments`）；
4. `part.delta` → UI 流式渲染，`tool.updated` → 工具卡片；
5. UI 层无需改动——`ChatPanel` 只依赖 AI SDK UI message stream，换 `transport` 即可。

## 五、2026-10-08 追加：login 实测结论与最终落地方案

按第四节做了实测（`zcode login` 成功，账号「旅行者4505」），发现了**更深的架构边界**：

1. **账号 provider 配置是桌面宿主经协议推送给 agent 的**（日志：
   `account provider config 已交付到 ZCode agent {providerCount:8}`）。独立 app-server
   没有宿主推送 → 模型注册表恒为空（`settings.model.available: []`），任何
   `modelSelection` 都报 `provider_not_found`。注入
   `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`/`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`
   指向桌面物化文件也无效。
2. **独立 CLI（`-p` 与 app-server）只认 `zcode login` 写入的 Z.AI OAuth 活跃身份**
   （credentials.json 的 `/oauth:active_provider`），`provider_config.json` 的
   `defaultModelSelection` 对它无效（实测传 bigmodel 也照走 zai）。
3. `login` 后 `-p` 模式**能完整走通模型请求**（鉴权、端点、流式）——被挡在
   套餐额度：该 zai 账号 individual-coding-plan 与 start-plan 均报
   `[1113] Insufficient balance or no resource package`（429）。
   桌面端在用的 bigmodel 个人编码套餐凭据在共享 credentials.json 里，但独立 CLI
   无法挂载它（同第 2 条，活跃身份锁死 + 宿主推送缺失）。

**最终落地方案（已实现于 `src/main/zcodeChatAgent.ts`）**：放弃 app-server 常驻客户端，
改为**每轮一个 `zcode -p --mode plan` 无头进程**（prompt = 对话转写种子 + 当前文档 +
问题，`--cwd` 指向文档所在目录）。stdout 增量推给渲染层；失败判定不看退出码（实测
失败也是 0），看 stderr 特征（`1113`/`Turn execution failed` 等）+ stdout 是否为空。
任何早失败 → 自动回落到 provider 管道（`handleChatWindow`），渲染层无感。
这样：zai 账号一旦有额度，同一二进制即刻开始输出真 ZCode agent 回答（自动生效，
含工作区阅读能力）；没额度时对话窗口走用户自己的 provider（现状可用）。

**待用户动作**：给 z.ai 的账号充值或订阅套餐后无需改任何代码；或等 ZCode CLI 后续
版本支持 bigmodel 身份 / 暴露账号切换。

## 六、2026-10-08 深夜：彻底打通——宿主三件套已实装

找到第五节两个结论的破局点：**账号层与鉴权材料本来就是设计给宿主提供的**（协议里的
`provider/updateAccountConfig` 和 `interaction/requestProviderRuntimeHeaders` 就是
宿主职责的扩展点），zpaper 把桌面宿主的三件事复刻出来即可。已实装于
`src/main/zcodeChatAgent.ts`（替换 `-p` 方案，app-server 常驻 + 真流式 + 服务端多轮会话）。

### 配方（全部实测验证）

1. **spawn**：app-server 注入两个 env——builtin 用端点物化文件（自动发现
   `~/.zcode/v2/runtime/provider/*/*/endpoint-*/zcode-builtin.json` 最新者），
   personal 用 `~/.zcode/v2/provider_config.json`。
2. **`provider/updateAccountConfig`**（建会话前推送）：params =
   `{revision, basedOnZCodeBuiltinRevision, providers, states}`。载荷从桌面日志的
   「account provider config 已交付」行还原：`receivedRevision` 的值去掉 `account:`
   前缀后 `JSON.parse` 得 `[builtinTag, rules, states]`；
   `providers = {providerId: rule.config}`（注意是 config 本体，不是规则外壳）。
3. **`interaction/requestProviderRuntimeHeaders`** 反向请求：回
   `{headersApplied: true, requestAuth: {apiKey: <zpaper 活动 provider 的 Key>}}`。
   bigmodel 编码套餐端点与开放平台 Key 同源（`open.bigmodel.cn/api/anthropic`），
   普通 API Key 直接可用——**计费走 zpaper 自己的 Key，与文档编辑同源同配置**，
   不占编码套餐额度。回 `headersApplied: false` 会被 agent 拒绝出字。
4. **发送**：`session/send` 带 `modelSelection`（注册表快照优先 GLM-5.3-Flash；
   **reasoningLevel 必填**，给 "low"）。

### 三个关键坑（都是实测踩出来的）

1. **正文流事件是 `model.streaming`**（`{delta, kind: "text_delta", done}`），
   不是协议文档里显眼的 `part.delta`——desktop-continuous 交付下后者不承载正文。
2. **Electron `protocol.handle` 的 handler 必须立刻返回 Response**，挂起超过一定
   时长 fetch 直接 `net::ERR_FAILED`。回落逻辑因此改为「流内管道」：Response 先行，
   SSE 先静默，ZCode 首个 token 前失败则把 provider 管道的 UI 流字节原样 pipe 进来。
3. **回合 Promise 必须在队列 close 时 resolve**：`turn.completed/failed` 事件路径
   若不 resolve，`runTurn` 永久挂起（事件驱动与 Promise 桥接的经典坑）。

### 现状

- 有 Key（任意 bigmodel 兼容 Key）：对话窗口 = 真 ZCode agent，plan 模式可读
  工作区，多轮上下文在 ZCode 会话内维护，流式输出。
- 无 Key / CLI 缺失 / 账号层日志缺失 / 出字前任何失败：无缝回落 provider 管道。
- `ZPAPER_NO_ZCODE_CHAT=1` 关闭整条 ZCode 通道；`ZPAPER_DEBUG_CHAT=1` 打印事件流。

