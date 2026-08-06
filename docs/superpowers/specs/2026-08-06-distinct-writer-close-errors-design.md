# Distinct Writer Close Error Design

## Problem

`writeFilesDistinctFromInput()` performs open, identity checks, truncate, and writes inside a `try`, then closes all output handles with `Promise.all()` in `finally`.

If the main operation fails and any handle close also fails, the close rejection replaces the original failure. If multiple closes fail, only one reason is exposed. This affects the shared writer used by compression and the owned `new-chat` package, weakening diagnostics and cleanup evidence.

## Decision

Capture the main operation failure, close every opened output handle with `Promise.allSettled()`, and classify the result after all closes finish:

- no operation failure and no close failure: return normally;
- no operation failure and one close failure: preserve that exact error object for compatibility;
- an operation failure with no close failure: preserve that exact operation error;
- an operation failure plus close failures, or multiple close failures: throw a flattened `AggregateError` with the operation leaves first and close leaves in handle-open order.

The aggregate summary names the multi-output close boundary and output paths but does not read or echo output data.

## Compatibility

Open flags, output creation/truncation/write order, inode conflict checks, successful bytes, compression decisions, new-chat package ownership/cleanup, command stdout, and transcript read-only behavior remain unchanged. Only multi-failure reporting becomes complete.

## Verification

- Inject one write failure and two independent close failures; require all three ordered causes.
- Inject two close failures after successful writes; require both causes.
- Keep the exact single-error identity for a lone operation or lone close failure.
- Run platform file, compression, new-chat, CLI error-formatting, and complete quality gates.
