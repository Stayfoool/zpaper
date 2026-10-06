# zpaper docx 支持选型报告

> 2026-10-06 · 立项评估 · 结论先行：**阶段 A（全 MIT 转换管线）已落地 v0.5.0；阶段 B SuperDoc PoC ✅ 验证通过（修订直写可行，见第 2B 节），可进入正式集成排期。**

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

### 路线 B：SuperDoc SDK——✅ PoC 验证通过（2026-10-06，`poc/superdoc-redline.mjs`）

- **形态惊喜**：官方 `@superdoc-dev/sdk` 是「原生二进制宿主 + 客户端 API」（open / query.match / replace / save…），无需浏览器环境，与我们主进程 spawn ZCode CLI 的模式同构
- **PoC 实测**：用我们管线生成合同 docx → SDK `open({ trackChanges: { replacements: "paired" }, userName: "zpaper AI" })` → `query.match` 定位「30 日」→ `doc.replace({ target, text: "45 日", changeMode: "tracked" })` → save → 解包验证：
  - `<w:del w:author="zpaper AI"><w:delText>30</w:delText></w:del>` + `<w:ins w:author="zpaper AI"><w:t>45</w:t></w:ins>` **教科书级修订标记，作者/日期齐全**
  - 替换粒度精准（只标删「30」，未动「日」）；find/replace/save 全链路 3 秒内
  - 关键参数：`changeMode: "tracked"`（动作级开关，未开时为普通编辑——第一版 PoC 就栽在这）
- **对接路径清晰**：AI 建议被接受后，把每处修改映射为 SDK 的 tracked replace（而不是整文件重写）， mammoth 打开腿保持不变。SDK 意图面极宽（表格/样式/批注/图片/节/目录共 300+ 操作），后续「修订直写」之外的增强空间大
- **顾虑更新**：①AGPL 与本项目 GPL-3.0 兼容（已确认可行）；②SDK 拉平台原生二进制（各平台 optionalDependency，CI 三平台均可用）；③输出文件由 SuperDoc 重写打包（PoC 中 20KB→8KB，简单文档无损，复杂文档保真需正式集成时回归）；④注意 v0.5.0 转换页方案与之独立，两条腿并存
- **正式集成工作量重估**：~1-2 周（原估 2-4 周，SDK 质量超预期）

### 路线 C：ONLYOFFICE Document Server——❌ 排除

完整 Word 引擎、保真最高、原生修订，但它是**重型自托管服务**（Docker/Linux 服务端 + 网页套件）。zpaper 是本地轻量桌面应用，捆绑一个文档服务器意味着安装包暴涨数百 MB、用户机器要跑服务进程——架构不匹配。仅当未来做「企业版服务端转换」时再回头看。

## 3. 建议方案（分阶段）

| 阶段 | 内容 | 许可 | 工作量 |
|---|---|---|---|
| **A（v0.5 ✅）** | 转换管线落地：打开/保存 .docx（内容结构级保真），设置里注明「复杂样式可能简化」；AI 修改保存为普通文本（非修订） | 全 MIT，与现栈零冲突 | 已上线 |
| **B（v0.6，已验证可行）** | SuperDoc SDK 修订直写：docx 来源的文档，AI 修改被接受后经 SDK `changeMode:"tracked"` 写回 Word 原生修订（作者=zpaper AI）；正式集成前对复杂文档做一轮保真回归 | SuperDoc AGPL（与本项目 GPL-3.0 兼容） | 1-2 周 |

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
