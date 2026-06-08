## 1. 评估文档

- [x] 1.1 阅读 `docs/work/00_TrimContext项目分析总览.md`，提取原型包提供的核心能力、可复用点和缺口判断。
- [x] 1.2 阅读 `docs/work/trimctx-integration-guide.md`，提取真实 JSONL 解析、token 估算、tool_result 和 away_summary 相关洞察。
- [x] 1.3 阅读 `docs/work/集成改造方案.md`，提取历史方案中仍可能有价值的能力，并标记已过时或已覆盖内容。
- [x] 1.4 检查当前 `src/`、`docs/requirements.md`、`docs/roadmap.md` 和 `docs/status-and-next-steps.md`，形成当前能力基线。
- [x] 1.5 创建 `docs/work/integration-value-assessment.md`，输出“已覆盖 / 当前缺失但有价值 / 当前缺失但暂缓 / 不建议集成”矩阵。
- [x] 1.6 在评估文档中明确列出当前没有但有价值的核心点，包括必要性等级、目标阶段、收益、风险和验证方式。
- [x] 1.7 在评估文档中明确说明不直接迁入 `context-rot-analyzer.tar.gz` 的原因。

## 2. 验证

- [x] 2.1 确认本 change 未修改 `src/` 业务代码。
- [x] 2.2 确认评估文档覆盖 `docs/work` 下 4 个输入：三份 markdown 和一个 tar.gz 原型包。
- [x] 2.3 确认评估文档至少列出 entity extraction、relations、配置化阈值、token 估算增强、compact/away_summary 信号这 5 个候选缺口，并给出是否集成判断。
- [x] 2.4 运行 `openspec.cmd status --change "evaluate-work-docs-integration" --json`，确认 proposal、specs、design、tasks 状态正确。
