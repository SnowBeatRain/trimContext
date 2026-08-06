export function formatCliError(error: unknown): string {
  const message = errorMessage(error);
  if (!(error instanceof AggregateError)) return message;

  const causes = error.errors.flatMap((component) => errorLeaves(component));
  return [
    message,
    ...causes.map((cause, index) => `Cause ${index + 1}: ${errorMessage(cause)}`)
  ].join("\n");
}

function errorLeaves(error: unknown): unknown[] {
  if (!(error instanceof AggregateError) || error.errors.length === 0) return [error];
  return error.errors.flatMap((component) => errorLeaves(component));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
