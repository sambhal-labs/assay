import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_BUDGETS, DEFAULT_EVAL } from '../constants.js';
import { AssayError } from './errors.js';
import type { ResolvedConfig, RuleOverride } from './types.js';
import { AssayConfigSchema, RuleOverrideSchema } from './types.js';

export const CONFIG_FILENAME = 'assay.config.json';

export function defaultConfig(): ResolvedConfig {
  return {
    rules: {},
    exclude: [],
    budgets: { ...DEFAULT_BUDGETS },
    eval: { ...DEFAULT_EVAL },
  };
}

/**
 * Loads assay.config.json from an explicit path (must exist) or from cwd
 * (optional). Zero-config always works: absence of a file yields defaults.
 */
export async function loadConfig(
  explicitPath?: string,
  cwd = process.cwd(),
): Promise<ResolvedConfig> {
  const path = explicitPath ? resolve(explicitPath) : resolve(cwd, CONFIG_FILENAME);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    if (explicitPath) throw new AssayError(`config file not found: ${path}`);
    return defaultConfig();
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new AssayError(
      `invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const parsed = AssayConfigSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new AssayError(`invalid config ${path}:\n${issues}`);
  }

  const cfg = parsed.data;
  return {
    rules: cfg.rules ?? {},
    ...(cfg.threshold ? { threshold: cfg.threshold } : {}),
    exclude: cfg.exclude ?? [],
    budgets: { ...DEFAULT_BUDGETS, ...cfg.budgets },
    eval: { ...DEFAULT_EVAL, ...cfg.eval },
  };
}

/** Parses the --rules flag ("SK101=off,MCP201=error") into overrides. */
export function parseRuleFlags(flag: string): Record<string, RuleOverride> {
  const overrides: Record<string, RuleOverride> = {};
  for (const pair of flag.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const [id, value, ...rest] = trimmed.split('=');
    const parsed = RuleOverrideSchema.safeParse(value);
    if (!id || !value || rest.length > 0 || !parsed.success) {
      throw new AssayError(
        `invalid --rules entry "${trimmed}"`,
        'expected <RULE_ID>=off|info|warn|error, e.g. --rules SK101=off,MCP201=error',
      );
    }
    overrides[id] = parsed.data;
  }
  return overrides;
}
