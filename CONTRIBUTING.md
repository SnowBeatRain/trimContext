# Contributing to trimctx

Thanks for your interest in contributing! This guide covers the basics.

## Development Setup

**Requirements:** Node.js 20+

```bash
git clone https://github.com/SnowBeatRain/trimContext.git
cd trimContext
npm install
```

## Development Workflow

1. Create a branch for your changes
2. Make your changes
3. Run tests and build
4. Open a pull request

## Commands

```bash
npm test              # Run all tests with the repository timeout
npm run build         # Compile TypeScript modules
npm run build:publish # Build the bundled CLI used by the npm package
npx tsx src/cli.ts    # Run CLI from source
```

For behavior-preserving refactors, run `npm run build`, `npm test`, and `git diff --check` before committing. When changing package contents, integration files, or install docs, also run `npm run build:publish` and `npx vitest run tests/package-contents.test.ts`.

## Code Guidelines

- **TypeScript strict mode** — the project uses `strict: true` in tsconfig
- **Tests first** — add or update tests for any behavior change
- **No LLM calls** — the core engine must remain fully local and offline
- **No data upload** — never send user conversation data anywhere
- **Conservative safety** — when in doubt, protect content rather than delete it

## Pull Request Process

1. Ensure `npm test` passes
2. Ensure `npm run build` passes
3. Add tests for new functionality
4. Keep changes focused — one concern per PR
5. Do not commit real user conversation transcripts

## Reporting Issues

- **Bugs** — include the error output, your Node.js version, and a sanitized sample if possible
- **False positives** — include the relevant message and expected behavior
- **False negatives** — include what should have been detected and why
- **Format support** — include a small sanitized sample of the transcript format

## Code of Conduct

Be respectful. Constructive feedback only. No harassment.
