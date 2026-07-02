import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/constants.js';
import { defaultConfig, loadConfig, parseRuleFlags } from '../../src/core/config.js';
import { AssayError } from '../../src/core/errors.js';

async function tempConfig(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'assay-config-'));
  const path = join(dir, 'assay.config.json');
  await writeFile(path, content);
  return path;
}

describe('loadConfig', () => {
  it('returns defaults when no config file exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'assay-empty-'));
    const config = await loadConfig(undefined, dir);
    expect(config).toEqual(defaultConfig());
    expect(config.budgets.mcpServerTokensWarn).toBe(DEFAULT_BUDGETS.mcpServerTokensWarn);
  });

  it('throws AssayError when an explicit config path is missing', async () => {
    await expect(loadConfig('/nonexistent/assay.config.json')).rejects.toThrow(AssayError);
  });

  it('merges user values over defaults', async () => {
    const path = await tempConfig(
      JSON.stringify({
        rules: { SK101: 'off', MCP201: 'error' },
        threshold: 'B+',
        exclude: ['fixtures/**'],
        budgets: { mcpServerTokensWarn: 4000 },
      }),
    );
    const config = await loadConfig(path);
    expect(config.rules).toEqual({ SK101: 'off', MCP201: 'error' });
    expect(config.threshold).toBe('B+');
    expect(config.exclude).toEqual(['fixtures/**']);
    expect(config.budgets.mcpServerTokensWarn).toBe(4000);
    // untouched budgets keep defaults
    expect(config.budgets.ctxTokensWarn).toBe(DEFAULT_BUDGETS.ctxTokensWarn);
  });

  it('rejects invalid JSON with a clean AssayError', async () => {
    const path = await tempConfig('{ not json');
    await expect(loadConfig(path)).rejects.toThrow(/invalid JSON/);
  });

  it('rejects unknown top-level keys', async () => {
    const path = await tempConfig(JSON.stringify({ thresold: 'B' }));
    await expect(loadConfig(path)).rejects.toThrow(AssayError);
  });

  it('rejects invalid rule override values', async () => {
    const path = await tempConfig(JSON.stringify({ rules: { SK101: 'silent' } }));
    await expect(loadConfig(path)).rejects.toThrow(/SK101/);
  });
});

describe('parseRuleFlags', () => {
  it('parses comma-separated id=severity pairs', () => {
    expect(parseRuleFlags('SK101=off, MCP201=error')).toEqual({
      SK101: 'off',
      MCP201: 'error',
    });
  });

  it('rejects malformed entries', () => {
    expect(() => parseRuleFlags('SK101')).toThrow(AssayError);
    expect(() => parseRuleFlags('SK101=loud')).toThrow(AssayError);
    expect(() => parseRuleFlags('SK101=off=warn')).toThrow(AssayError);
  });
});
