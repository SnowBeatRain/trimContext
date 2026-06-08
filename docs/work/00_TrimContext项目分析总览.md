# TrimContext 项目分析总览

> 基于上传的 `context-rot-analyzer.tar.gz` 源码包、现有 TrimContext 规划材料，以及 Claude Code 工作流集成目标整理。

## 1. 结论

上传的 `context-rot-analyzer` 不是一个完整产品，而是一个**上下文腐烂评分算法原型库**。它已经具备 TrimContext 核心算法雏形，但距离可用 CLI 产品还缺少输入解析、命令行入口、tokenizer、compress 输出、真实样本验证、测试和配置化能力。

建议处理方式：

1. **不要丢弃这个项目**，它可以作为 TrimContext 的 `core/analyzers` 初版基础。
2. **不要直接发布它**，当前它无法作为最终用户工具使用。
3. **将它重构进 TrimContext 主工程**，补齐 parser、CLI、report schema、compress、测试和数据验证。
4. **第一版仍坚持“离线文件分析优先”**，实时 hook / statusline 放到 v0.2/v0.3。

## 2. 当前项目结构

源码包结构如下：

```text
context-rot/
  package.json
  tsconfig.json
  demo.ts
  src/
    index.ts
    types/index.ts
    analyzers/
      decisionEngine.ts
      protectionRules.ts
      rotScorer.ts
    reporters/
      cliReporter.ts
    utils/
      entityExtractor.ts
```

当前代码已经实现：

| 模块 | 状态 | 说明 |
|---|---:|---|
| NormalizedMessage 类型 | 已有 | 统一消息结构雏形 |
| RotDimensions | 已有 | superseded/reference/age/redundancy/orphanTool |
| protectionRules | 已有 | system、recent、永久指令、架构/API/schema、确认结论、被引用 tool_result |
| rotScorer | 已有 | 权重评分 + confidence |
| decisionEngine | 已有 | 保护规则优先，然后 rotScore + confidence 决策 |
| entityExtractor | 已有 | 文件路径、函数名、类名、错误、变量、决策关键词 |
| cliReporter | 已有 | 终端摘要 + JSON 保存 |
| demo.ts | 已有 | mock session 演示 |

当前缺失：

| 模块 | 状态 | 影响 |
|---|---:|---|
| CLI 命令 | 缺失 | 用户不能直接 `trimctx analyze file` |
| Claude Code JSONL parser | 缺失 | 不能读取真实 Claude Code 会话 |
| OpenAI JSONL parser | 缺失 | 通用性不足 |
| tokenizer | 缺失 | 当前 tokens 需要外部传入 |
| compressor | 缺失 | 不能生成 trimmed 文件 |
| report schema 稳定化 | 缺失 | 现在字段更像内部报告 |
| 测试 | 缺失 | 无法保证误删边界 |
| 配置系统 | 缺失 | 阈值、最近消息窗口、规则开关不可调 |
| 真实数据验证 | 缺失 | 还没有 5 个长对话验证准确率 |
| 构建依赖完整性 | 有问题 | 当前包缺少 `@types/node`，`tsc --noEmit` 会报 Node 类型缺失 |

## 3. 当前代码的可复用价值

### 3.1 可以直接吸收的部分

以下部分建议保留，并迁入 TrimContext：

```text
src/types/index.ts
src/analyzers/rotScorer.ts
src/analyzers/decisionEngine.ts
src/analyzers/protectionRules.ts
src/utils/entityExtractor.ts
src/reporters/cliReporter.ts
```

对应到 TrimContext 新目录：

```text
trimcontext/src/core/analyzers/
trimcontext/src/core/rules/
trimcontext/src/core/entities/
trimcontext/src/core/reporting/
trimcontext/src/types/
```

### 3.2 需要重构的部分

| 当前实现 | 问题 | 建议 |
|---|---|---|
| `MessageRole = system/user/assistant/tool` | 缺少 `developer`、`unknown` | 扩展 role 类型 |
| `tokens` 必填 | 实际 parser 需要自动计算 | 改为 normalize 阶段计算 |
| API/schema 一律保护 | 可能保护已经失效的旧 schema | 加入 superseded 检查 |
| recent window 固定 10 | 不同任务需要配置 | 改成 config |
| compress 节省按 60% 估算 | v0.1 不做真实摘要，容易误导 | 区分 removable saving 与 potential compress saving |
| `decisionReason` 是字符串 | 不利于机器处理 | 增加 `reasons: ReasonCode[]` |
| `relations` 只挂在消息分析中 | 难以全局查看依赖图 | 报告顶层增加 `relations` |
| 无 warnings | parser 和规则命中异常不可追踪 | 增加 warnings/errors |

## 4. 与 TrimContext 目标的关系

TrimContext 的产品目标不是“做一个算法库”，而是：

```text
读取真实长对话 → 规范化 → 分析 rot → 给出可审计报告 → 生成安全压缩副本
```

`context-rot-analyzer` 当前覆盖的是中间一段：

```text
已规范化消息 → rot 分析 → 报告
```

因此它在 TrimContext 中的位置应该是：

```text
parsers → normalizer → analyzer(context-rot-analyzer 核心) → reporter → compressor
```

## 5. 建议采用的目标版本

### v0.1 目标

让用户可以运行：

```bash
trimctx analyze <session.jsonl>
trimctx report <session.jsonl> -o <report.json>
trimctx compress <session.jsonl> -o <trimmed.jsonl>
```

v0.1 只做离线分析和安全压缩。

### v0.2 目标

让用户不用手动找 Claude Code 文件：

```bash
trimctx sessions
trimctx analyze --latest
trimctx watch --latest
```

### v0.3 目标

接入 Claude Code 当前会话：

```bash
trimctx install-hooks
trimctx hook
trimctx statusline
```

## 6. 最重要的产品原则

第一版必须坚持：

```text
先离线，后实时
先报告，后压缩
先保护，后评分
先规则，后 LLM
先可审计，后自动化
```

第一版成功标准不是“删得最多”，而是：

```text
能解释为什么删
能证明没有误删关键上下文
能稳定处理真实 Claude Code JSONL
能输出可复查的 report.json
能生成不覆盖原文件的 trimmed 副本
```
