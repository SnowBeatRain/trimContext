# docs/work/ — 迁移过程文档

> 本目录包含从 `context-rot-analyzer` 原型到 `trimctx` 的迁移过程记录。
> 当前代码实现请以 `src/` 目录为准。

## 当前目录结构

```
docs/work/
├── README.md                        ← 本文件
├── integration-value-assessment.md  ← 仍有效的待办事项清单
├── trimctx-integration-guide.md     ← JSONL 格式边界情况参考（代码片段已过时）
└── _archive/                        ← 完全过期的历史文档
    ├── 00_TrimContext项目分析总览.md
    └── 集成改造方案.md
```

## 文件说明

### 当前有效

| 文件 | 状态 | 说明 |
|------|------|------|
| `integration-value-assessment.md` | **仍有效** | 待办事项清单：P0（compact signal、parser fixtures）、P1（entity extraction、token estimation、candidate categories）、v0.3+（relations graph、configurable thresholds）。优先级评估与当前迭代计划一致。 |
| `trimctx-integration-guide.md` | **部分有效** | JSONL 格式边界情况（isMeta 过滤、streaming dedup、tool_result 内容变体、away_summary 检测）仍有参考价值。代码片段已过时，实际 parser 在 `src/adapters/`。 |

### 归档

| 文件 | 说明 |
|------|------|
| `_archive/context-rot-analyzer.tar.gz` | context-rot-analyzer 原型源码包，迁移完成后不再需要。 |
| `_archive/00_TrimContext项目分析总览.md` | 原型分析。迁移工作已完成，内容完全被 `src/` 实现替代。 |
| `_archive/集成改造方案.md` | 早期迁移方案（1977 行），含完整代码模板。实际采用了不同方案（`adapters/` 而非 `parsers/`、vitest 而非 Jest、`compress_candidate` 为 report-only 等）。已添加历史标注。 |
