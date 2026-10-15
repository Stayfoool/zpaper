# BlockNote xl-ai 0.55.0：流式部分应用（isPossiblyPartial）在多次重放后留下错误的建议标记（CJK 文档必现）

## 现象

用 `AIExtension`（html 文档格式）对**中文**文档执行 update 操作并接受建议后，文档出现：

- 文字重复：被替换的原文保留，新文字追加在旁边（如 `（张三等，2020）张三等，Zhang et al., 2020`）；
- 错位拼接：与本次修改无关的相邻文字被错误删除/复制（如 `由此引发的城` + `岛效应日益受到关注（` 同时被标记 deletion + insertion）。

同一操作在**非流式**（完整操作一次性执行）下结果完全正确；流式下是否损坏与 chunk 边界有关（随机复现）。

## 环境

- @blocknote/xl-ai / core 0.55.0（最新）
- @handlewithcare/prosemirror-suggest-changes 0.1.8
- Electron 41 / Chrome 146，GLM-5.3（Anthropic 兼容端点）
- 复现项目：https://github.com/Stayfoool/zpaper （GPL-3.0，可直接运行）

## 最小复现步骤

1. 编辑器加载中文文档（含多个 `（作者，年份）` 引用的段落）；
2. 选中若干段落，指令如「把正文中所有括号里的参考文献标为蓝色」或「把中文引用改成（Zhang et al., 2020）格式」；
3. 模型输出的 update 操作（HTML）完全正确（已在主进程抓取原始流验证）；
4. 等待进入 user-reviewing，检查 `editor.prosemirrorState.doc`：除预期 change 外，出现与本次修改无关文字的 deletion+insertion 标记对；
5. acceptChanges() 后上述错误固化到文档。

## 证据要点

- 模型原始工具调用（主进程日志）：update HTML 为正确的原地修改，无重复；
- `updateToReplaceSteps` 产出的 ReplaceStep（对 projection diff）：位置与替换文字全部正确；
- 错误的标记在 user-reviewing 阶段已存在，acceptChanges 只是如实应用（`acceptChanges` 的 doc 替换逻辑本身无错）；
- **规避验证**：在 transport 层把 UIMessage SSE 流中的 `tool-input-delta` 事件全部丢弃（使工具输入只能以 `tool-input-available` 一次性到达，`filterNewOrUpdatedOperations` 对最后一个 operation 的 `isPossiblyPartial: i === chunk.operations.length - 1` 判定与流式重放路径不再触发多次「应用→回滚→重放」），中文文档的标蓝/改引用格式/润色全部正确。

## 怀疑点（供上游排查）

1. 流式期间每个 chunk 都会以 `isPossiblyPartial=true` 重放操作（回滚上一次部分应用再应用新的）。回滚/重放经过 `createHTMLRebaseTool` 的投影（applySuggestions）+ `updateToReplaceSteps` + `getStepsAsAgent` 手工 deletion/insertion 标记，多轮之后标记范围与文档实际内容错位；
2. `filterNewOrUpdatedOperations` 中 `isPossiblyPartial: i === chunk.operations.length - 1` 使**最后一条 operation 即使已完整**也会走 partial 路径（`dontReplaceContentAtEnd=true` 的「回填尾部内容」启发式对已完整操作不安全）；
3. 疑似与 CJK 相关：ASCII 文档同一流程未复现。

## 我们当前的修复（zpaper 侧，pnpm patch）

`patches/@blocknote__xl-ai@0.55.0.patch`（注册于 pnpm-workspace.yaml `patchedDependencies`）：
在 `createUpdateBlockTool` 与 `createAddBlocksTool` 的 executor 入口直接跳过 `isPossiblyPartial` 的执行轮次（`if (chunk.isPossiblyPartial) return true`）。

- 依据：`filterNewOrUpdatedOperations` 对每个 operation 最终都会以 `isPossiblyPartial: false` 再 yield 一次，跳过 partial 轮次后每个操作恰好以完整数据执行一次，无损；
- 效果：中文文档的标蓝 / 改引用格式 / 润色三场景 E2E 通过——接受后正文与模型工具调用的意图文本逐字一致、建议标记 0 残留（此前流式下随机出现重复/截断）；
- 代价：仅失去「模型生成过程中的半截预览」；最终修改应用时仍有逐字打出的 agent 动画（`withDelays` 路径不受影响）；
- 撤补条件：上游修复 partial 重放的建议标记记账（或提供关闭部分执行的开关）后，删除 `patches/` 中对应文件与 `pnpm-workspace.yaml` 的注册项即可。

> 历史：我们曾短期用「transport 层过滤 SSE `tool-input-delta` 事件」规避（效果等价），后改为上述包内补丁以覆盖所有传输路径（含内置演示模式的 mock 流）。

