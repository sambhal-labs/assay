import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Judge-response cache: a warm rerun of `assay eval` replays the stored raw
 * responses and makes zero network calls. Keyed on everything that shapes
 * the scenario (skill name+description, sampled corpus, model, prompt
 * template version), so any change re-runs the eval instead of lying.
 */
export interface EvalCacheEntry {
  promptsVersion: number;
  positives: string[];
  /** Raw judge responses, one per routing scenario, in scenario order. */
  responses: string[];
}

export function cacheKey(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export function defaultCacheDir(cwd = process.cwd()): string {
  return join(cwd, '.assay', 'cache');
}

const entryPath = (dir: string, key: string): string => join(dir, `eval-${key}.json`);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');

/** Missing or corrupted entries are a cache miss, never a failure. */
export async function readCacheEntry(dir: string, key: string): Promise<EvalCacheEntry | null> {
  let raw: string;
  try {
    raw = await readFile(entryPath(dir, key), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as EvalCacheEntry).promptsVersion === 'number' &&
      isStringArray((parsed as EvalCacheEntry).positives) &&
      isStringArray((parsed as EvalCacheEntry).responses)
    ) {
      return parsed as EvalCacheEntry;
    }
    return null;
  } catch {
    return null;
  }
}

/** Lazily creates the cache directory on first write. */
export async function writeCacheEntry(
  dir: string,
  key: string,
  entry: EvalCacheEntry,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(entryPath(dir, key), `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
}
