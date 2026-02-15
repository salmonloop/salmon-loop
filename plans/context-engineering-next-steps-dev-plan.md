# 上下文工程：下一步开发方案（成功率优先）

> 日期：2026-02-15  
> 目标：继续降低 Top1“改错文件/范围”，并让上下文构建具备可解释、可观测、可回放的闭环。  
> 约束：完全自动；不强耦合特定场景；复用 Grizzco Pipeline + DSL（MicroTaskRunner）+ 事务语义；强化事件上报与审计落盘。

---

## 1. 当前基线（已具备）

1. `TargetResolver`（DSL）产出 `context.targets`，并在 XML `<manifest>` 中输出（范围自约束）。
2. `packUntilFull`：diff 保留（截断而非全丢），且对 `targets` 的 related/snippets 具备优先级。
3. AST 诊断以 `<analysis><ast>...</ast></analysis>` 输出（语法错误/parse error）。
4. Context build 关键节点写入 audit trail（关键词、gather 汇总、targets 选择等）。

---

## 2. 下一步总目标（P0/P1）

### P0：Targeting 更“准”（符号/引用驱动）

把“改错范围”的核心矛盾从“有没有 targets”升级为“targets 是否足够精确”：

- 从指令中提取 **结构化候选**（路径/标识符/反引号 token/错误名）后，
- 用 AST 的 `definitionMap` 将 **标识符 → 定义位置**，
- 进一步映射到 **定义所在文件**（至少先覆盖 primaryFile 内定义；跨文件定位作为 P1）。

**验收指标（最低可行）**：
- `targets` 里出现 `symbol_definition` 的比例提升（有标识符指令时）。
- 对“改错文件/范围”回放集：修改文件命中 targets 的比例提升。

### P1：Targeting 驱动“收集与排序”（不仅是 manifest）

把 `targets` 变成一等公民，贯穿 gather → rank → pack：

1. `rankContextForRelevance` 增加 targets 加权（targets 文件最高优先，邻域次之，rg 最低）。
2. `AstGatherer` 输出的 `relatedFiles` 在超预算风险下优先给 targets 邻域 outline。
3. `RipgrepGatherer` 的结果在 budget 紧张时只保留 targets 命中的 snippet（或相邻目录）。

**验收指标**：
- 截断发生时，targets 文件仍能保留更高比例的 full/outline（而不是被非 targets 挤掉）。

---

## 3. 增量闭环（“失败驱动扩上下文”，P1）

当 verify/patch 失败时，引入一个纯确定性的 `ContextExpander`：

- 输入：verify 输出 / diff-security 输出 / apply-back 失败信息（已存在结构化日志与部分错误分类）。
- 产出：需要补充的文件/符号集合（优先从 targets 邻域扩展）。
- 约束：永不请求用户确认；扩展有上限（文件数、深度、预算分区配额）。

**验收指标**：
- 回放集上二次构建后成功率提升（或 iteration count 下降）。

---

## 4. 事件上报与审计落盘（贯穿）

### 4.1 事件（建议统一 schema）

新增/补齐以下 action（只记录摘要，不记录大段代码）：

- `context.targeting.candidates`：候选标识符/路径数、来源（instruction/backtick/error/path）
- `context.targeting.symbol_resolution`：命中数量、未命中原因分类（no_def / parse_error / unsupported_lang）
- `context.relevance.ranking`：topK 文件与分数（可截断）
- `context.pack.summary`：各 section chars、diff 截断比例、dropped sections

### 4.2 落盘

保持与现有 audit 文件机制一致（append delta），新增字段应保持向后兼容。

---

## 5. 分阶段执行计划（建议按顺序）

### Phase A（P0）：符号候选 → 目标文件（最小跨文件）

1. 扩展关键词/候选提取：输出 `identifiers[]`（已能提取标识符，但需要显式产出结构化候选列表）。
2. `TargetResolver` 新增数据键：`symbolTargets`（primaryFile 内 definitionMap 命中）并进入 DSL 选择链路：
   - 优先级建议：explicit_path > symbolTargets > diffTargets > defaultTargets
3. XML manifest 扩展：targets 增加 evidence（symbol name / location）。

### Phase B（P1）：targets 驱动 relevance

1. `rankContextForRelevance`：将 targets 文件分数提升，并让非 targets 更易降级 outline。
2. 对 rgSnippets：targets 文件片段优先，非 targets 片段更易丢弃。

### Phase C（P1）：失败驱动扩上下文（ContextExpander）

1. 定义 `ContextExpander` 接口与实现（纯函数/可测试）。
2. 在 verify 失败路径接入（不改变正常路径），并记录 audit events。

---

## 6. 测试与验证

1. 单测：
   - TargetResolver：symbolTargets 命中/未命中分支、优先级覆盖
   - relevance/pack：targets 加权与降级行为
2. 集成回放（最小）：基于现有 integration harness，挑 5–10 条“改错范围”样例。
3. 交付门槛：`pnpm verify` 必须全绿。

---

## 7. 风险控制

1. 规则过拟合：所有规则必须依赖通用信号（路径/符号/diff/import），禁止“修 bug 专用”分支。
2. 成本失控：所有扩展行为必须有硬上限（文件数、深度、分区配额）。
3. 审计泄露：evidence 只允许符号名/路径/行号/计数，不落盘代码正文。

---

## 8. 需要确认的 1 个选择（不阻塞，但影响优先级）

下一步优先先做哪一个？

1. **Phase A（符号定位 targets）**（推荐，直接打 Top1）
2. Phase C（失败驱动 ContextExpander）

> 若不确认，默认从 **1** 开始。

