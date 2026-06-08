# Security Policy

## Core Safety Principle

trimctx is designed to **never delete by mistake**. The original conversation file is never modified.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately:

1. **Do not** open a public GitHub issue
2. Email the maintainer with details of the vulnerability
3. Include steps to reproduce if possible

## What Counts as a Security Issue

- The `compress` command modifies the original input file
- Protected content is deleted during compression
- File path traversal in the `-o` output flag
- Arbitrary code execution through crafted JSONL input
- Sensitive data leakage through error messages or reports

## What Does NOT Count

- A message being incorrectly scored (false positive/negative) — this is a bug, not a security issue. Please open a regular issue.
- Feature requests for new transcript format support

## Best Practices for Users

- Always verify the input file hash before and after running `compress`
- Use sanitized fixtures for testing — never commit real conversation transcripts
- Review the report before running `compress`
- Keep private conversation data in `datasets/private/` (gitignored)
