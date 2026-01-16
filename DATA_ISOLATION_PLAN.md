# 多应用数据隔离（分库/分目录）实施方案

## 背景 / 问题
当前工程是一个“多应用同仓”的形态（至少包含 `chatos`、`aide`、`git`、`wsl`）。
用户期望：每个应用只维护**自己**的 MCP 列表、Prompt 列表、Models/Secrets/Settings 等数据；各应用数据互不影响。

本次方案目标是把“数据所有权”做到物理隔离：**按应用分目录 + 按应用分库**，并建立一套可复用的存储框架（common 包），让每个应用基于该框架实现自己的数据层。

## 总目标（验收口径）
- `~/.chatos/` 下固定存在（或按需创建）四个应用目录：
  - `~/.chatos/chatos/`
  - `~/.chatos/aide/`
  - `~/.chatos/git/`
  - `~/.chatos/wsl/`
- 任一应用：
  - **只读写**自己的 `~/.chatos/<app>/` 目录与数据库。
  - 不会因为扫描/插件/迁移把别的应用的 MCP/Prompt 写入自己的 DB。
- AIDE 的“配置选项 → MCP Servers”只出现 AIDE 自己的 MCP。
- ChatOS 的“配置选项 → MCP Servers”只出现 ChatOS 自己的 MCP（以及它自己明确聚合/引用的外部项，但不写入别的应用的数据）。

> 说明：在 Windows 上对应路径为 `%USERPROFILE%\.deepseek_cli\<app>\`。

## 核心原则：数据所有权与跨应用边界
1. **物理隔离优先**：每个应用有独立的 stateDir 与 admin DB，默认不跨目录写入。
2. **定义 vs 选择分离**：
   - “定义类数据”（MCP server 定义、Prompt 内容、默认模型列表等）归属其应用。
   - “选择/启用类数据”（某个对话/Agent 选择了哪些 MCP/Prompts）也归属发起选择的应用。
3. **跨应用交互必须显式**：
   - 允许跨应用“只读引用”（读取对方定义）
   - 禁止跨应用“隐式写入”（把对方定义复制/同步进自己 DB）
4. **命名空间清晰**：任何跨应用引用必须携带 `hostApp`（例如 `git:serverName`），避免同名冲突。

## 目录规范（建议固定结构）
每个应用目录结构一致（允许按应用裁剪）：

```
~/.chatos/
  chatos/
    chatos.db.sqlite
    auth/
      models.yaml
      system-prompt.yaml
      system-default-prompt.yaml
      system-user-prompt.yaml
      subagent-system-prompt.yaml
      subagent-user-prompt.yaml
      mcp.config.json
    sessions/
    terminals/
    events.jsonl
    ui_apps/
      plugins/
      data/
  aide/
    aide.db.sqlite
    auth/...
    sessions/...
    terminals/...
    events.jsonl
    ui_apps/...   (仅 AIDE 自己的插件生态；不共享/不迁移 chatos 的)
  git/
    git.db.sqlite
    auth/...
    events.jsonl
    (可选) ui_apps/...  (若 git 应用本身需要)
  wsl/
    wsl.db.sqlite
    auth/...
    events.jsonl
```

## common 包：存储/状态框架抽取
建议新增一个 common 包（示例命名：`packages/state-core` 或 `common/state-core`），只提供“框架能力”，不包含任何具体应用的业务默认值。

### state-core 应提供的能力
- **路径与目录**：
  - `resolveStateDir(hostApp)`：返回 `~/.chatos/<hostApp>`
  - `ensureStateDir(hostApp)`：创建目录
  - sessionRoot/marker 处理（若保留“会话根”概念，需保证最终落盘仍在 `~/.chatos/<app>` 语义下）
- **DB 封装**（sql.js/SQLite）：
  - `createDb(dbPath, schemaVersion, migrations, seed)`
  - 文件锁/原子写入/并发安全
  - 统一的 migration 入口与 marker
- **Service 基类**：CRUD、Zod 校验、错误格式化
- **sync-to-files（可选）**：把 DB 快照导出到 `auth/*.yaml|json` 供 CLI/运行时读取

### 每个应用仍必须自定义的部分
- 表结构（schema）与 migrations
- 默认 seed（内置 MCP/Prompts/Models）
- 权限与可见性策略（哪些可编辑、哪些锁定）
- UI/CLI 如何消费这些数据

## 应用侧实现：每个应用拥有自己的“数据层入口”
对每个应用（chatos/aide/git/wsl）建立独立的“数据层入口模块”，统一负责：
- 设置 `hostApp`（例如环境变量或启动参数）
- 解析自己的 stateDir 与 DB 路径
- 初始化 DB（migrate + seed）
- 提供 `services`（models/secrets/mcpServers/prompts/subagents/settings/...）
- 触发 sync-to-files（如果该应用需要 `auth/` 导出）

> 关键：任何“写入 admin DB”的路径都必须从当前应用入口拿到，禁止从别的应用入口/目录派生。

## UI Apps / 插件扫描策略（避免“扫描即写库”的副作用）
这是目前最容易导致串库的入口，需要明确策略。

### 统一规则
- **扫描插件 ≠ 把插件的 ai.mcp/ai.mcpPrompt 写进 host 的 admin DB**。
- 插件 manifest 里的 `ai.mcp`/`ai.mcpPrompt` 属于插件（或插件所属应用）的“定义”，默认只应：
  - 作为“注册表/目录”在内存中展示；或
  - 写入插件所属应用（`git`/`wsl`）自己的 DB（而不是 `chatos`/`aide` 的 DB）。

### 推荐实现（两种方案二选一）
**方案 A（更轻，推荐优先落地）**：
- `git`/`wsl` 的 MCP/Prompt 定义只来自它们的 `plugin.json`（manifest），不落地到任何 host 的 admin DB。
- `chatos` 在需要展示/使用时，直接从 manifest 生成“只读 registry”；
- `chatos` 只在自己 DB 里保存“引用/启用状态”（例如 `selectedMcp = [{ hostApp:'git', name:'git_manager', enabled:true }]`），不复制定义。

**方案 B（更规范，满足“每个应用都有自己的数据库”字面要求）**：
- `git`/`wsl` 应用在 `~/.chatos/git|wsl/<app>.db.sqlite` 中维护：
  - 自己的 mcpServers（locked、定义类数据）
  - 自己的 prompts（locked、定义类数据）
  - 自己的 settings/凭据（如需要）
- `chatos` 展示时通过“跨应用只读读取”获取 `git/wsl` 的定义（读取它们的 DB 或通过它们的 backend API），仍只在 `chatos` DB 存引用与启用选择。

> 两者都满足“互不干扰”；B 更贴合你要求的“四个目录各自维护数据”，但实现量更大。

## 迁移方案（必须可回滚）
### 迁移目标
- 把历史遗留/误写的数据搬到正确应用目录，避免“看似分库但内容已混入”。

### 迁移步骤（建议分阶段）
1. **备份**：对现有 `~/.chatos/*` 做整目录备份（或至少备份 `*.db.sqlite`，含历史遗留 `admin.db.sqlite`）。
2. **建立目录**：确保 `chatos/aide/git/wsl` 四个目录存在。
3. **识别归属**：
   - 依据 `record.app_id`（若存在且可信）
   - 依据 tags（如 `uiapp:*`）
   - 依据来源标记（pluginId/appId）
   - 无法识别的进入“待人工确认清单”。
4. **搬运/重建**：
   - AIDE 中误写的 git/wsl MCP：迁移到 `git/wsl`（或按方案 A 直接删除并改为运行时从 manifest 生成）。
   - ChatOS 的 UI apps 数据只进入 `chatos`。
5. **写入 marker**：在每个应用目录写入迁移 marker（版本号/时间/来源），避免重复迁移。

## 风险与对策
- **并发访问 DB**：锁文件必须位于各自应用目录下，避免跨应用互相阻塞。
- **跨应用引用的稳定性**：引用必须带 `hostApp` + 稳定 key（serverName/promptName 或 UUID），禁止仅用 name。
- **插件卸载/缺失**：若引用指向的应用/插件不可用，UI 需要可诊断（显示“缺失/未安装”）并允许清理引用。

## 里程碑（建议）
- M0：确定采用方案 A 还是 B（本方案文档评审结论）。
- M1：落地 state-core（路径/DB/migration 基建）并让 `chatos/aide` 都只写自己的 `~/.chatos/<app>`。
- M2：改造 UI Apps 扫描：禁止“扫描即写入 host admin DB”，改为 registry-only 或写入所属应用 DB。
- M3：引入 `git/wsl` 的独立 stateDir 与 DB（若选方案 B），并补齐跨应用只读引用加载。
- M4：迁移工具 + 备份/回滚策略 + 验收脚本（手动/自动）。

## 验收清单（最小可验证项）
- AIDE 启动/配置变更只影响 `~/.chatos/aide/`。
- ChatOS 启动/配置变更只影响 `~/.chatos/chatos/`。
- git/wsl 的任何配置/状态只影响 `~/.chatos/git|wsl/`。
- AIDE 的 MCP 列表不出现 git/wsl；即便 git/wsl 插件存在，也不会被写入 AIDE DB。
- 删除 `~/.chatos/aide/` 不会破坏 chatos/git/wsl 的配置与运行。
