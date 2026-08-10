# Security Policy

## Core Safety Principle

trimctx is designed to **never delete by mistake**. The original conversation file is never modified, and ambiguous ownership or message identity fails closed before replacement output is committed.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately:

1. **Do not** open a public GitHub issue
2. 通过 [GitHub Security Advisories](https://github.com/SnowBeatRain/trimContext/security/advisories/new) 提交漏洞报告，或在 [GitHub Issues](https://github.com/SnowBeatRain/trimContext/issues/new) 中标记为安全问题（不要包含漏洞细节）
3. Include steps to reproduce if possible

## What Counts as a Security Issue

- The `compress` command modifies the original input file
- Protected content is deleted during compression
- File path traversal in the `-o` output flag
- Arbitrary code execution through crafted JSONL input
- Sensitive data leakage through error messages or reports
- Claude hook command injection or concurrent settings replacement that installs an unintended command
- Repository installers deleting or replacing directories they cannot prove belong to trimctx

## What Does NOT Count

- A message being incorrectly scored (false positive/negative) — this is a bug, not a security issue. Please open a regular issue.
- Feature requests for new transcript format support

## Best Practices for Users

- Always verify the input file hash before and after running `compress`
- Use sanitized fixtures for testing — never commit real conversation transcripts
- Review the report before running `compress`
- Keep private conversation data in `datasets/private/` (gitignored)
- Treat summary redaction as defense in depth, not proof that a full JSON report, export, or continuation package is safe to share
- Rerun `trimctx init --with-hooks` after moving the Node executable or installed package because hook settings pin both absolute paths

Automatic hooks accept at most 1 MiB of stdin. Stop analysis additionally accepts at most a 64 MiB transcript and 10,000 normalized messages; these hook-only limits do not restrict explicit CLI analysis. SessionStart writes only the current binding through `CLAUDE_ENV_FILE`; Stop keeps the transcript read-only and may update only the trimctx-managed block in `.claude/CLAUDE.md`.

The repository install scripts update an existing checkout only when its exact Git origin matches the requested repository. An existing plugin directory is replaced only when the trimctx marker or exact legacy asset fingerprint proves ownership; unknown targets are rejected without recursive deletion.
