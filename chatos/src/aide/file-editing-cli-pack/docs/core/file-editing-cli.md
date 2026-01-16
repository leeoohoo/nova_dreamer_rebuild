# Gemini CLI 文件修改（write_file / replace）实现拆解与复刻指南（CLI 风格）

本文聚焦 **Gemini CLI 自己如何“改文件”**（不是 MCP）。目标是让你在另一个项目里复刻同等体验：**模型提出修改 → 生成 diff → 终端里确认/拒绝/改稿 → 落盘写文件 → 返回 diff 结果**。

核心涉及两类能力：

- **编辑工具（Core）**：`write_file`（整文件写入/覆盖）与 `replace`（按 old/new string 做替换，也可用于“创建新文件”）。
- **CLI 交互（Ink UI）**：在终端里渲染 unified diff、用选择列表确认、支持“用外部编辑器修改提案”。

---

## 0. 关键文件（你复刻时建议按这个链路拷）

**核心工具与调度：**

- `packages/core/src/tools/write-file.ts`：`write_file` 工具（写入/覆盖文件 + diff + 纠错）
- `packages/core/src/tools/edit.ts`：`replace` 工具（替换/创建文件 + 多策略匹配 + 自纠错）
- `packages/core/src/tools/modifiable-tool.ts`：统一的“Modify with external editor”适配层
- `packages/core/src/core/coreToolScheduler.ts`：处理确认结果（含 `ModifyWithEditor`）
- `packages/core/src/tools/tools.ts`：确认结构体、`ToolConfirmationOutcome`、基类确认/策略更新
- `packages/core/src/tools/diffOptions.ts`：diff 选项与 diff 统计（model vs user）

**安全/鲁棒性（强烈建议一起复刻）：**

- `packages/core/src/utils/workspaceContext.ts`：限制可操作路径必须在 workspace 内（含 realpath/symlink）
- `packages/core/src/utils/pathCorrector.ts`：相对路径/模糊路径自动纠正（bfs 搜索 + 歧义检测）
- `packages/core/src/services/fileSystemService.ts`：文件读写抽象（默认 fs/promises）
- `packages/core/src/utils/textUtils.ts`：`safeLiteralReplace`（处理 `$` 替换陷阱）
- `packages/core/src/utils/editCorrector.ts`：修复“Gemini 转义 bug/片段不匹配”的纠错层（带缓存）
- `packages/core/src/utils/llm-edit-fixer.ts`：替换失败时的二次 LLM 修复（超时 + 缓存）

**外部编辑器 & 终端恢复：**

- `packages/core/src/utils/editor.ts`：`openDiff()`，支持 VS Code/Vim/Neovim/Emacs 等
- `packages/core/src/utils/events.ts`：`CoreEvent.ExternalEditorClosed`（终端 editor 退出后刷新 UI）
- `packages/cli/src/ui/AppContainer.tsx`：监听 `ExternalEditorClosed`，恢复 alternate buffer 等终端状态

**CLI diff 与确认 UI：**

- `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx`：确认对话框（选项 + DiffRenderer）
- `packages/cli/src/ui/components/messages/DiffRenderer.tsx`：unified diff 渲染（行号、配色、折叠）
- `packages/cli/src/ui/components/messages/ToolResultDisplay.tsx`：执行后展示 diff 结果
- `packages/cli/src/ui/components/shared/RadioButtonSelect.tsx` / `BaseSelectionList.tsx` / `useSelectionList.ts`：终端选择列表（键盘导航）

---

## 1. 总体架构：从“模型工具调用”到“写盘”

你可以把改文件流程拆成 4 层：

1. **Tool 参数校验（DeclarativeTool.build → validate）**
2. **生成确认信息（Invocation.shouldConfirmExecute → getConfirmationDetails）**
3. **用户确认 / 修改提案（CoreToolScheduler.handleConfirmationResponse）**
4. **真正写盘（Invocation.execute → FileSystemService.writeTextFile）**

### 1.1 统一的“确认结构体”

文件修改类工具最终都会产出 `ToolEditConfirmationDetails`（定义在 `packages/core/src/tools/tools.ts`）：

- `type: 'edit'`
- `title`
- `filePath / fileName`
- `fileDiff`：`diff` 包生成的 unified diff（`Diff.createPatch`）
- `originalContent / newContent`：确认时展示的内容快照
- `onConfirm(outcome, payload?)`：用户选择后的回调
- `isModifying?: boolean`：当用户选择“外部编辑器修改”时用于 UI 提示

CLI 只关心这些字段即可做出“像 git 一样”的确认体验。

---

## 2. 工具一：`write_file`（整文件写入/覆盖）

源码：`packages/core/src/tools/write-file.ts`

### 2.1 参数（WriteFileToolParams）

- `file_path: string`：目标路径（实现里会 `path.resolve(targetDir, file_path)`）
- `content: string`：要写入的完整内容
- `modified_by_user?: boolean` / `ai_proposed_content?: string`：用于记录“用户是否改过模型提案”

### 2.2 路径与 workspace 限制（validateToolParamValues）

`write_file` 的校验逻辑特点：

- `resolvedPath = path.resolve(config.getTargetDir(), file_path)`
- 必须 `workspaceContext.isPathWithinWorkspace(resolvedPath)`（否则拒绝）
- 如果路径已存在且是目录：拒绝（防止把目录当文件写）

这保证了 LLM 不能写到 workspace 外（例如 `~/.ssh/config`）。

### 2.3 “纠错层”：写入前先修正 content（getCorrectedFileContent）

这是 Gemini CLI 比很多简单实现更“成熟”的点：它假设模型输出可能带 **转义/换行错误**，会在写盘前做一次纠错。

逻辑分叉：

- **文件存在**：读出 `originalContent`，然后调用 `ensureCorrectEdit(...)`，把“整文件内容当 old_string”，把 `proposedContent` 当 new_string，做 **最小纠错**（尤其是修复错误转义）。
- **文件不存在**：调用 `ensureCorrectFileContent(...)`，主要用于修复“内容被过度转义”的情况。

> 复刻建议：如果你不打算引入 LLM 二次纠错，至少保留“发现可疑转义 → 做一次 unescape/normalize”的快速通道，否则模型很容易写出带 `\\n` 的文件。

### 2.4 确认（getConfirmationDetails）

当 `config.getApprovalMode() !== AUTO_EDIT`：

1. 先拿到 `correctedContent`
2. 生成 diff：
   - `Diff.createPatch(fileName, originalContent, correctedContent, 'Current', 'Proposed', DEFAULT_DIFF_OPTIONS)`
3. 组装 `ToolEditConfirmationDetails`
4. `onConfirm` 里做两件事：
   - 处理“允许策略”（`ProceedAlways`/`ProceedAlwaysAndSave`）→ `publishPolicyUpdate` 或直接切 `ApprovalMode.AUTO_EDIT`
   - （可选）IDE diff 模式下：等待 IDE 返回用户最终内容并覆盖 `params.content`

### 2.5 执行（execute）

执行阶段会：

- 确保父目录存在（`fs.mkdirSync(..., { recursive:true })`）
- `fileSystemService.writeTextFile(resolvedPath, fileContent)`
- 再生成一次 diff 作为结果展示（Original → Written）
- 计算 `diffStat`：区分 `model` 修改量 vs `user` 二次修改量（`getDiffStat`）
- 返回 `ToolResult.returnDisplay` 为 `{ fileDiff, fileName, originalContent, newContent, diffStat }`，CLI 用它渲染 diff

---

## 3. 工具二：`replace`（搜索替换 + 可创建文件）

源码：`packages/core/src/tools/edit.ts`

### 3.1 参数（EditToolParams）

必填：

- `file_path`
- `instruction`：这不是用于执行替换，而是用于“失败时二次 LLM 自纠错”的高质量语义描述
- `old_string` / `new_string`

可选：

- `expected_replacements?: number`（默认 1）
- `modified_by_user?` / `ai_proposed_content?`

### 3.2 路径纠正（validateToolParamValues）

与 `write_file` 不同，`replace` 会主动把路径纠正为绝对路径：

- 若 `file_path` 不是绝对路径 → `correctPath(file_path, config)`：
  - 先尝试 `targetDir + relativePath`
  - 不存在则在 workspace 多目录里 BFS 搜索（最多 50 目录）
  - 找不到/歧义 → 直接报错
- 然后再次检查 `workspaceContext.isPathWithinWorkspace(absPath)`

这解决了模型常见的“写了个相对路径/不完整路径”的问题。

### 3.3 计算编辑结果（calculateEdit）

这里是 `replace` 的核心：**先计算会改成什么**，再决定是否需要确认/执行。

1. 读文件：
   - 存在：读取文本、检测原始换行风格（CRLF vs LF），并 normalize 成 LF
   - 不存在：如果 `old_string === ''` 则允许“创建新文件”；否则返回“文件不存在”错误
2. 新文件规则：
   - `old_string === '' && !fileExists` → `isNewFile=true`，`newContent = new_string`
3. 非新文件规则：
   - 若 `old_string === '' && fileExists` → 错误（试图创建已存在文件）
4. 真正替换：`calculateReplacement(...)`

### 3.4 替换策略（calculateReplacement）：exact → flexible → regex

Gemini CLI 的替换不是“只做严格匹配”，而是三段式降级：

1. **exact**：`safeLiteralReplace(currentContent, old, new)`（先 normalize CRLF→LF）
2. **flexible（按行 trim 匹配）**：
   - 将 `old_string` 每行 `trim()` 后与源文件滑窗对比
   - 命中后用“第一行缩进”给 `new_string` 每行补缩进
3. **regex（token + whitespace 容忍）**：
   - 把 `old_string` 按分隔符和空白切成 tokens
   - 生成 `^(\\s*)token\\s*token\\s*...` 的多行 regex
   - 只替换首个命中，并继承捕获到的缩进

每种策略都会记录 telemetry（`EditStrategyEvent`）。

### 3.5 失败自纠错（attemptSelfCorrection）

如果替换后出现：

- 找不到 `old_string`（0 次）
- 命中次数 ≠ `expected_replacements`
- `old_string === new_string`（无变化）

则进入二次修复：

1. 先用 SHA256 检查文件是否在“我们第一次读取后”被外部改过；如果改过就以磁盘最新版本为准，避免 clobber。
2. 调用 `FixLLMEditWithInstruction(...)`（`packages/core/src/utils/llm-edit-fixer.ts`）让 LLM 给出：
   - `search`（修正后的 old_string）
   - `replace`（通常不改）
   - `noChangesRequired`（如果改动已存在）
3. 再跑一次 `calculateReplacement` 验证能成功则接受修复，否则回退原错误。

> 复刻建议：这是“成熟度”很高的一环；如果你不想引入二次 LLM，至少保留“文件被外部改动则重读”的保护。

### 3.6 确认（getConfirmationDetails）

与 `write_file` 类似，确认时会：

- 先 `calculateEdit` 得到 `currentContent/newContent`
- 生成 `Diff.createPatch(fileName, currentContent, newContent, 'Current', 'Proposed', DEFAULT_DIFF_OPTIONS)`
- 返回 `ToolEditConfirmationDetails`
- `onConfirm` 里处理策略更新，并在 IDE diff 模式下用 IDE 结果覆盖 `params.old_string/new_string`

### 3.7 执行（execute）

执行阶段会：

- 再次 `calculateEdit`（避免确认后内容变化导致落盘错误）
- 写盘前恢复 CRLF（如果原文件是 CRLF）
- `fileSystemService.writeTextFile(file_path, finalContent)`
- 返回展示结果：
  - 新文件：返回字符串 `Created <path>`
  - 旧文件：返回 `{ fileDiff, fileName, originalContent, newContent, diffStat }`

---

## 4. “CLI 工具风格”的确认体验：diff + 选项

### 4.1 确认 UI（ToolConfirmationMessage）

源码：`packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx`

当 `confirmationDetails.type === 'edit'`：

- 主体渲染：`<DiffRenderer diffContent={fileDiff} filename={fileName} ... />`
- 选项（trusted folder 下更丰富）：
  - `Allow once` → `ProceedOnce`
  - `Allow for this session` → `ProceedAlways`
  - `Allow for all future sessions` → `ProceedAlwaysAndSave`（需开启设置）
  - `Modify with external editor` → `ModifyWithEditor`（IDE diffing 启用时会隐藏）
  - `No, suggest changes` → `Cancel`

它还绑定了快捷键：

- `Esc` / `Ctrl+C` → Cancel

### 4.2 diff 渲染（DiffRenderer）

源码：`packages/cli/src/ui/components/messages/DiffRenderer.tsx`

关键点：

- 输入是 unified diff（`Diff.createPatch` 产物）
- 自己解析 `@@ -a,b +c,d @@` hunk header，给每行补上 old/new 行号
- 对 `+ / - / context` 行做不同背景色与前缀符号
- 对“跨度很大的上下文”插入 gap 分隔（`MAX_CONTEXT_LINES_WITHOUT_GAP = 5`）
- 如果是“新文件 diff”（全是 add 行）：抽出新增内容用语法高亮渲染（`colorizeCode`）

### 4.3 执行后结果展示（ToolResultDisplay）

源码：`packages/cli/src/ui/components/messages/ToolResultDisplay.tsx`

如果 `ToolResult.returnDisplay` 是对象且包含 `fileDiff` 字段，就会再次用 `DiffRenderer` 渲染，从而实现：

- 确认时看 diff
- 执行后历史里也能回看 diff

---

## 5. “Modify with external editor” 的完整链路

这是 CLI 风格里非常关键的一点：用户不需要在聊天框里改大段代码，直接开熟悉的 editor。

### 5.1 Core：scheduler 如何处理 ModifyWithEditor

源码：`packages/core/src/core/coreToolScheduler.ts`（`handleConfirmationResponse` 分支）

当用户选 `ToolConfirmationOutcome.ModifyWithEditor`：

1. 确认该工具实现了 `ModifiableDeclarativeTool`（`getModifyContext`）
2. 把 tool call 状态保持在 `awaiting_approval`，但标记 `isModifying: true`（UI 显示“Modify in progress”）
3. 调 `modifyWithEditor(...)`：
   - 生成临时 diff 文件（old/new 两个）
   - 打开外部 diff editor
   - 用户保存退出后读回 new 文件内容
   - 用 `createUpdatedParams` 把“用户最终内容”回写到 tool args
   - 重新生成 updated diff
4. `setArgsInternal(callId, updatedParams)`，并把确认态的 `fileDiff` 刷新为 updated diff（`isModifying:false`）
5. 回到同一个确认 UI，让用户再次选择 “Allow once / Cancel …”

### 5.2 Core：modifyWithEditor 如何做临时文件与回写

源码：`packages/core/src/tools/modifiable-tool.ts`

- `createTempFilesForModify`：
  - `fs.mkdtempSync(os.tmpdir()/gemini-cli-tool-modify-*)`
  - chmod 700（目录）+ chmod 600（文件）
  - 写入 old/new 两份文本
- `openDiff(oldPath, newPath, editorType)`：阻塞直到 editor 退出
- `getUpdatedParams`：
  - 读回 old/new 内容
  - `modifyContext.createUpdatedParams(oldContent, newContent, originalParams)`
  - 生成新的 patch（用于 UI）
- finally：清理临时文件与目录

### 5.3 Core：openDiff 支持哪些编辑器

源码：`packages/core/src/utils/editor.ts`

- GUI：`code/codium/cursor/windsurf/zed/...` 用 `--wait --diff old new`
- 终端：`vim/nvim` 用 `-d` 开 diff，并把左侧设为只读、右侧可编辑，`BufWritePost` 自动 `wqa`
- `emacs` 用 `ediff`
- 终端 editor 退出后会 `coreEvents.emit(CoreEvent.ExternalEditorClosed)`（让 CLI 恢复终端模式）

### 5.4 CLI：外部 editor 退出后恢复终端状态

源码：`packages/cli/src/ui/AppContainer.tsx`

监听 `CoreEvent.ExternalEditorClosed`：

- 如启用 alternate buffer：重新 `enterAlternateScreen()`、恢复 mouse/line wrapping 等模式
- `app.rerender()` + 清屏刷新

> 复刻建议：如果你也用 Ink/类似 TUI 框架，**一定要处理“外部 editor 改写了终端模式”的恢复**，否则 UI 很容易花屏或鼠标/换行模式不一致。

---

## 6. 复刻建议：最小实现骨架（贴近 Gemini CLI）

如果你只想复刻“本地改文件 + CLI 确认 + 外部 editor 修改”，可以用如下最小骨架：

1. **两个工具实现**（write_file / replace）
   - 负责：参数校验、读文件、算出 newContent、生成 diff、写盘、返回 diff result
2. **统一确认结构体**（`ToolEditConfirmationDetails`）
3. **一个调度器**（像 `CoreToolScheduler`）
   - tool call 状态机：validating → awaiting_approval → scheduled → executing → success/error/cancelled
   - 处理 outcome：Proceed/Cancel/ModifyWithEditor
4. **CLI UI**
   - `DiffRenderer(unifiedDiff)`
   - 单选列表 + Esc/Ctrl+C 取消
5. **外部 editor**
   - `mkdtemp + 写 old/new + openDiff + 读回 + 清理`

你可以从这两个“最小版本”开始：

- 简化版：没有二次 LLM 纠错（`ensureCorrectEdit` / `FixLLMEditWithInstruction` 全删）
- 完整版：把二次纠错加回来，显著提升成功率与用户体验

