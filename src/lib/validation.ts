interface ValidationIssue {
  path: readonly PropertyKey[];
  message: string;
}

/** Keep the first message per field, grouping unrecognised fields under `form` when requested. */
export function fieldErrorsFromIssues(issues: readonly ValidationIssue[], fields?: readonly string[]) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? 'form');
    const key = fields && !fields.includes(field) ? 'form' : field;
    errors[key] ??= issue.message;
  }
  return errors;
}
