# zpaper ✨

**AI 帮你写文档的桌面编辑器。** 像 Word 一样编辑，选中文字直接给 AI 下指令，AI 就地改写，修改处以修订式高亮呈现，逐处接受或拒绝。

支持接入你自己已有的大模型服务（GLM Coding Plan、智谱 BigModel、DeepSeek、Kimi、OpenAI、Anthropic 等），API Key 只保存在你自己的电脑上。

## 下载安装

从 [GitHub Releases](https://github.com/Stayfoool/zpaper/releases) 下载对应平台的安装包：

| 平台 | 文件 |
|---|---|
| Windows | `zpaper-x.y.z-setup.exe`（Windows 10/11 x64） |
| macOS (Apple Silicon) | `zpaper-x.y.z-arm64.dmg` |
| macOS (Intel) | `zpaper-x.y.z.dmg` |

> 安装包未做代码签名，首次运行时 Windows SmartScreen / macOS Gatekeeper 可能提示「未知发布者」：
> - Windows：点「更多信息 → 仍要运行」
> - macOS：右键 App →「打开」，或在「系统设置 → 隐私与安全性」中允许

## 怎么用

1. **打开/新建文档**：支持 Word（`.docx`）与 Markdown（`.md` / `.txt`），右上角「打开」「新建」「保存」
2. **手动编辑**：直接打字，支持标题、列表、表格、代码块、图片等
3. **AI 编辑**：选中任意文字 → 工具栏点「AI 编辑」→ 输入指令（如「改得更简洁」「翻译成英文」）
4. **审阅修改**：AI 的修改以高亮呈现，点 **接受** 或 **恢复**
5. **接入模型**：右上角「⚙ 设置」→ 快速添加你的模型服务 → 填 API Key → 测试连接 → 保存

> 未配置模型时，AI 按钮走**内置演示模式**，可以完整体验交互流程。

## 支持的模型服务

zpaper 走标准协议，凡提供 OpenAI 兼容或 Anthropic 兼容 API 的服务均可接入：

| 服务 | 协议 | Base URL | 模型示例 |
|---|---|---|---|
| GLM Coding Plan（z.ai） | OpenAI 兼容 | `https://api.z.ai/api/coding/paas/v4` | `GLM-5.2` |
| 智谱 BigModel 开放平台 | OpenAI 兼容 | `https://open.bigmodel.cn/api/paas/v4` | `GLM-5.2` |
| GLM（Anthropic 兼容） | Anthropic 兼容 | `https://api.z.ai/api/anthropic` | `GLM-5.2` |
| DeepSeek | OpenAI 兼容 | `https://api.deepseek.com` | `deepseek-chat` |
| Kimi（Moonshot） | OpenAI 兼容 | `https://api.moonshot.cn/v1` | `kimi-k2.5` |
| OpenAI | OpenAI 兼容 | `https://api.openai.com/v1` | `gpt-4.1` |
| Anthropic 官方 | Anthropic 兼容 | `https://api.anthropic.com` | `claude-sonnet-4-5` |
| 自定义 | OpenAI 兼容 | 你的端点 | 你的模型 |

模型名以服务商文档为准，设置里可自由修改。

## Agent 模式（实验性，v0.3+）

让 AI **参考你的整个工作区**来修改文档，而不只看单篇文档：设置里勾选「Agent 模式」并选择工作区文件夹后，每次修改前，本机已安装的 **ZCode**（ZCode 桌面版自带，或 PATH 上的 `zcode`）会以**只读模式**浏览工作区，把与修改要求相关的背景（项目事实、术语、数据）整理成摘要，注入改写请求。

- 使用你现有的 ZCode 登录/Coding Plan，无需额外配置；ZCode 的模型凭证需可用
- 只读安全：研究阶段使用 `--mode plan`，ZCode agent 不会改你的工作区文件
- 研究失败（如未登录）时自动降级：照常完成文档修改，仅无背景资料

## 多人协作（实验性，v0.4+）

基于 Yjs（CRDT）的实时协同编辑：多人同编一份文档、实时显示彼此光标；AI 的修改在接受后同步给所有协作者（审查是个人视角，互不打扰）。

**1. 启动协作服务器**（任何一台机器，文档自动落盘）：

```bash
cd zpaper && node server/collab-server.mjs
# 监听 ws://0.0.0.0:1234，可用 PORT=xxx 改端口，ZPAPER_COLLAB_DIR 改文档存储目录
```

**2. 各人加入**：zpaper 顶栏「协作」→ 填服务器地址（如 `ws://192.168.x.x:1234`）和房间名 → 加入。同一房间的人实时共编。

## 隐私

- 文档保存在你自己的磁盘（Markdown 格式，永远可迁移）
- API Key 保存在本机应用配置目录，只用于直连你选择的模型服务商
- zpaper 不上传任何数据，没有自己的服务器

## 从源码构建

```bash
git clone https://github.com/Stayfoool/zpaper.git
cd zpaper
pnpm install
pnpm dev        # 开发模式
pnpm dist       # 打当前平台的安装包到 release/
```

要求 Node.js ≥ 20 与 pnpm。

## 技术栈

Electron + React + [BlockNote](https://blocknotejs.org)（`xl-ai` AI 编辑扩展）+ [Vercel AI SDK](https://sdk.vercel.ai)。

架构上，AI 的修改走「建议模式」：模型通过工具调用（`applyDocumentOperations`）对文档块做增删改，客户端以 suggestion/track-changes 形式渲染，用户逐条接受或恢复——即 Word 修订模式的 AI 版。

## Roadmap

- [x] **变更面板**（v0.2）：汇总每次 AI 修改（指令/涉及块/前后对照/状态），点击跳转到修改位置
- [x] **docx 支持选型报告**（v0.2）：见 [docs/docx-选型报告.md](docs/docx-选型报告.md)——阶段 A 转换管线（全 MIT，已 PoC 验证）
- [x] **Agent 模式**（v0.3，实验性）：修改前由本机 ZCode agent 只读浏览工作区，AI 基于项目背景改文档
- [x] **多人协作**（v0.4，实验性）：Yjs CRDT + 自托管小服务器，多人实时共编 + 远程光标 + AI 修改接受后同步
- [x] **docx 打开/保存**（v0.5）：直接打开/保存 .docx（内容结构级保真：标题/加粗/列表/表格；视觉样式会简化）。选型报告见 [docs/docx-选型报告.md](docs/docx-选型报告.md)
- [x] **docx 修订直写**（v0.6）：docx 来源的文档保存时，接受的修改以 Word 原生修订（w:ins/w:del，作者 zpaper）写回——Word/WPS 里可逐条审阅；阶段 B 选型结论见 [docs/docx-选型报告.md](docs/docx-选型报告.md)
- [ ] 自定义 AI 菜单指令（中文快捷指令）
- [ ] 应用图标与代码签名
- [ ] Linux 版

## License

[GPL-3.0](LICENSE)
