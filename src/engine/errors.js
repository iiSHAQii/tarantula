// Errors the CLI/MCP layers show to the user as a message, not a stack trace.
export class UserError extends Error {}
export class NotFound extends UserError {}
// The source can't answer right now (5xx, block page, timeout). Callers fall back to the next source.
export class SourceDown extends Error {}
