/**
 * Expected, user-facing failures: bad paths, invalid config, unreachable MCP
 * servers. The CLI prints these as a single clean line and exits 2. Anything
 * else that escapes is an assay bug and gets a stack trace (still exit 2).
 */
export class AssayError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'AssayError';
  }
}
