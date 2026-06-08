# trimctx 使用说明

本文档说明当前源码版 trimctx 的安装、运行和命令使用方式。项目尚未公开发布到 npm，以下命令默认在项目根目录运行。

## 1. 环境要求

- Node.js 20+
- npm
- Windows / macOS / Linux

当前验证环境主要是 Windows。

## 2. 安装依赖

```bash
npm install
```

## 3. 运行测试和构建

```bash
npm test
npm run build
```

## 4. 从源码运行

```bash
npx tsx src/cli.ts --help
```

分析一个 JSONL 文件：

```bash
npx tsx src/cli.ts analyze path/to/session.jsonl
```

写入完整报告：

```bash
npx tsx src/cli.ts report path/to/session.jsonl -o report.json
```

生成安全压缩副本：

```bash
npx tsx src/cli.ts compress path/to/session.jsonl -o session.trimmed.jsonl
```

## 5. 构建后运行

```bash
npm run build
node dist/cli.js --help
```

分析：

```bash
node dist/cli.js analyze path/to/session.jsonl
```

报告：

```bash
node dist/cli.js report path/to/session.jsonl -o report.json
```

压缩：

```bash
node dist/cli.js compress path/to/session.jsonl -o session.trimmed.jsonl
```

## 6. 支持的输入格式

当前支持：

- Claude Code JSONL
- OpenAI JSONL

暂不支持：

- 纯文本对话
- 数据库
- 远程 API
- 浏览器页面抓取

## 7. analyze

当前 v0.1 行为：

```bash
npx tsx src/cli.ts analyze path/to/session.jsonl
```

输出完整 JSON report。

v0.2 计划行为：

```bash
trimctx analyze path/to/session.jsonl
```

默认输出短摘要；完整 JSON 改为：

```bash
trimctx analyze path/to/session.jsonl --json
```

## 8. report

```bash
npx tsx src/cli.ts report path/to/session.jsonl -o report.json
```

输出完整 JSON 报告。报告包含：

- 输入文件信息
- summary
- 每条 message 的 tokens / decision / reasons / scores
- remove_candidates
- warnings

## 9. compress

```bash
npx tsx src/cli.ts compress path/to/session.jsonl -o session.trimmed.jsonl
```

`compress` 只写入新文件，不修改原文件。

v0.1 删除规则：

| decision | 行为 |
| --- | --- |
| `keep_protected` | 保留 |
| `keep` | 保留 |
| `compress_candidate` | 保留 |
| `remove_candidate` | 删除，前提是不是 protected |

## 10. 安全注意事项

- 不要把输出路径设为输入文件路径。
- 不要提交真实 transcript。
- 真实样本验证输出放在 `tmp-real-validation/`。
- 私有数据放在 `datasets/private/`。
- 公开 fixture 必须先脱敏。

## 11. 常见验证流程

```bash
npm test
npm run build
npx tsx src/cli.ts analyze tests/fixtures/claude-code-realistic.jsonl
npx tsx src/cli.ts report tests/fixtures/claude-code-realistic.jsonl -o tmp-real-validation/report.json
npx tsx src/cli.ts compress tests/fixtures/claude-code-realistic.jsonl -o tmp-real-validation/compressed.jsonl
```

如果验证真实 Claude Code 样本，请先记录输入文件 hash，压缩后再次确认 hash 不变。

PowerShell 示例：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath "path\to\session.jsonl"
```

## 12. 当前限制

- `analyze` 目前仍输出完整 JSON，大文件下不适合人工阅读。
- 暂无 `latest` / `sessions` / `doctor`。
- 暂无 Claude Code slash command / hooks / statusline。
- 暂无 npm 发布包。

