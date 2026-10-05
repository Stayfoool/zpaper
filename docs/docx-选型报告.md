# zpaper docx 支持选型报告

> 2026-10-06 · 立项评估 · 结论先行：**分两阶段走——阶段 A 用全 MIT 转换管线落地「打开/保存 docx」（已 PoC 验证，1-2 周）；阶段 B 跟踪 SuperDoc 评估原生修订（w:ins/w:del）；ONLYOFFICE 排除。**

## 1. 目标

让 zpaper 用户直接打开/编辑/保存 Word（.docx）文件，AI 修改体验与 Markdown 一致；远期让 AI 修改以 Word 原生「修订」（w:ins/w:del）写回，接收方在 Word 里可见修订痕迹。

## 2. 候选路线与 PoC 结果

### 路线 A：转换管线（mammoth + @blocknote/server-util + html-to-docx）——✅ 已实测通过

数据流：`docx --mammoth--> html --server-util--> blocks（编辑器内） --server-util--> html --html-to-docx--> docx`

**PoC 实测**（`poc/docx-roundtrip.mjs`，可复跑）：
- 用 docx 库生成含 H1/H2、加粗、项目符号列表、2 行表格、段落的中文测试文档（9.9KB）
- mammoth 转 html：`<h1> <strong> <ul> <table>` 全部保留
- server-util `tryParseHTMLToBlocks`：8 个块全部正确解析（heading / paragraph / bulletListItem / table）
- 回程 blocks→html→docx→再读回：**文本逐字一致**，表格/加粗/H2 全保留
- 全链路依赖均为 MIT；server-util 就是我们编辑器同版本（0.55.0）的官方包，块模型零转换损耗

**限制**：保真度为「内容与结构级」——字体/颜色/页眉页脚/文本框等视觉样式有损（mammoth 的设计取舍）；不支持写 Word 原生修订标记。

**工作量**：主进程接入（文件对话框扩展 .docx + 转换调用 + UI 提示）约 **1-2 周**。

### 路线 B：SuperDoc（@harbour-enterprises/superdoc）——跟踪，二期评估

- 定位：浏览器/服务端两用的 docx 编辑器，ProseMirror 底座 + **OOXML 直接往返（不经 HTML）**，原生 track changes（redlines）、comments；提供 Document API / Node SDK / **MCP server**，明确面向 AI 场景
- 现状核实（2026-10-06）：v1.46.3，**AGPL-3.0**（+商业双许可），GitHub 1082★，99 open issues，最近推送 2026-10-02（非常活跃）
- 优势：高保真 + 原生修订写回，最贴合「AI 修改以 Word 修订呈现」的完全体
- 顾虑：①AGPL 传染（本项目已定 GPL-3.0，**可组合**，无阻塞）；②项目年轻，API 稳定性未知；③与 BlockNote 是两套编辑器，若整体替换编辑器底座则 xl-ai 的 AI 交互要重新适配——**这是最大的架构成本**
- **建议**：不替换编辑器。二期先评估「SuperDoc 仅作为 docx 的读写/修订服务」（文档级转换，编辑仍用 BlockNote）——PoC 其 `export`/`redlines` API 与 BlockNote html 的互转质量，2-3 天可出结论

### 路线 C：ONLYOFFICE Document Server——❌ 排除

完整 Word 引擎、保真最高、原生修订，但它是**重型自托管服务**（Docker/Linux 服务端 + 网页套件）。zpaper 是本地轻量桌面应用，捆绑一个文档服务器意味着安装包暴涨数百 MB、用户机器要跑服务进程——架构不匹配。仅当未来做「企业版服务端转换」时再回头看。

## 3. 建议方案（分阶段）

| 阶段 | 内容 | 许可 | 工作量 |
|---|---|---|---|
| **A（v0.3）** | 转换管线落地：打开/保存 .docx（内容结构级保真），设置里注明「复杂样式可能简化」；AI 修改保存为普通文本（非修订） | 全 MIT，与现栈零冲突 | 1-2 周 |
| **B（v0.4+ 评估）** | SuperDoc 作为 docx 服务：AI 修改写回 Word 原生修订（redlines）；2-3 天 PoC 出结论后再排期 | AGPL（与本项目 GPL-3.0 兼容） | PoC 2-3 天；落地 2-4 周 |

## 4. 风险与缓解

- **样式失真**：转换管线的已知取舍；UI 明示「内容级保真」，重要样式文档建议用户在 Word 里套模板
- **复杂文档解析失败**：mammoth 对不合规 docx 有容错，失败时降级为「按纯文本打开」并提示
- **SuperDoc 停滞/许可变化**：阶段 B 只是可选增强，不阻塞主线
- **html-to-docx 表格样式**：PoC 验证基础表格 OK；复杂合并单元格需在阶段 A 中加一轮真实文档回归

## 5. PoC 复现

```bash
cd zpaper
node poc/docx-roundtrip.mjs
# 产物在 /tmp/zpaper-docx-poc/：original.docx / step1.html / roundtrip.docx / step4.html
```
