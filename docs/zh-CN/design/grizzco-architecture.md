# Grizzco V3 "Bifrost" 架构

## 概览

Grizzco V3 架构（代号 "Bifrost"）是 SalmonLoop 自动化编码系统的下一代引擎。它旨在解决在确定性决策过程中管理异步操作（如 LLM 调用、Git 操作）的复杂性。

## 核心设计原则

### 1. 编排与决策分离

- **宏观编排 (Pipeline)**: 处理阶段的线性流转（`PREFLIGHT` -> `CONTEXT` -> `PLAN` ...）。它管理状态转换和错误恢复。
- **微观决策 (DSL)**: 处理特定阶段内的逻辑（例如，选择合并策略）。它是纯粹的、同步的且无副作用的。

### 2. Ping-Pong 协议（异步桥接）

为了允许同步 DSL 基于异步数据（例如，“远程文件是否已锁定？”）做出决策，V3 引入了挂起机制：

1. **决策引擎** 遇到 `requireData('key')` 规则。
2. 如果数据缺失，它返回 `NEED_DATA` 信号。
3. **微观编排器** 暂停执行，从 **服务注册表** 获取数据。
4. 上下文被丰富，决策引擎重新运行。

### 3. 渐进式上下文

通过“渐进式上下文”强制执行类型安全。流水线中的每个步骤接收特定的上下文类型（例如 `PatchCtx`）并返回更丰富的类型（例如 `ValidateCtx`）。这保证了数据可用性与执行阶段相匹配。

## 核心组件

### 流水线 (`src/core/grizzco/v3/pipeline.ts`)

一个类型化的异步流水线引擎，支持：

- **步骤 (Steps)**: 原子工作单元。
- **恢复 (Recovery)**: `stepWithRecovery` 允许处理失败（例如，紧急回滚）。
- **遥测 (Telemetry)**: 内置追踪（Spans）用于性能监控。

### 决策引擎 (`src/core/grizzco/v3/dsl/DecisionEngine.ts`)

一个执行 DSL 策略的纯 TypeScript 类。它生成一个结构化的 `ExecutionPlan` (JSON)，描述应该执行的操作，而不实际执行。

### 执行器 (`src/core/grizzco/v3/execution/Executor.ts`)

系统的“肌肉”。它接收 `ExecutionPlan` 并使用专用的 Worker 执行实际的副作用（文件写入、Git 合并）。

### 服务注册表 (`src/core/grizzco/v3/services/registry.ts`)

异步数据提供者（`GitConfigService` 等）的中心枢纽，使 Ping-Pong 协议能够动态获取数据。

## 目录结构

```
src/core/grizzco/v3/
├── dsl/            # 纯决策逻辑
├── execution/      # 副作用执行器与 Worker
├── flows/          # 宏观编排 (SalmonLoopV3)
├── services/       # 数据获取器
├── steps/          # 流水线步骤
├── pipeline.ts     # 流水线引擎
└── types.ts        # 渐进式上下文定义
```
