/**
 * Prompt-injection phrase detection (SK401 / MCP301 / CTX006) and related
 * risky-content detectors (SK404 fetch-and-execute, SK405 base64 blobs).
 * Lexical heuristics — documented as such; the goal is catching the known
 * tool-poisoning signatures, not general NLP.
 */

export interface PhraseHit {
  pattern: string;
  match: string;
  index: number;
}

const INJECTION_PATTERNS: ReadonlyArray<readonly [name: string, re: RegExp]> = [
  [
    'ignore-instructions',
    /\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+instructions\b/gi,
  ],
  [
    'conceal-from-user',
    /\bdo\s+not\s+(?:tell|inform|mention|reveal|alert|notify|warn)\s+the\s+user\b/gi,
  ],
  ['conceal-from-user', /\b(?:don't|do\s+not|never)\s+(?:mention|reveal|show|display)\s+this\b/gi],
  ['hide-this', /\bhide\s+this\s+(?:from|message|instruction|tool)\b/gi],
  [
    'system-prompt-exfil',
    /\b(?:reveal|print|show|extract|read|repeat|output|leak)\b[^.\n]{0,60}\bsystem\s+prompt\b/gi,
  ],
  ['tool-precedence', /\bbefore\s+(?:using|calling|invoking)\s+any\s+other\s+tool\b/gi],
  ['tool-precedence', /\b(?:always\s+)?(?:use|call|invoke)\s+this\s+tool\s+(?:first|instead)\b/gi],
  ['pseudo-tag', /<\/?(?:important|system|admin|hidden|secret|instructions?)>/gi],
];

const FETCH_EXECUTE_PATTERNS: ReadonlyArray<readonly [name: string, re: RegExp]> = [
  ['curl-pipe-shell', /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da|fi)?sh\b/gi],
  ['download-and-run', /\bdownload\s+(?:and|then)\s+(?:run|execute)\b/gi],
  ['eval-fetch', /\beval\s*\(\s*(?:await\s+)?(?:fetch|request|urlopen)\b/gi],
];

function scan(text: string, patterns: ReadonlyArray<readonly [string, RegExp]>): PhraseHit[] {
  const hits: PhraseHit[] = [];
  for (const [pattern, re] of patterns) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      hits.push({ pattern, match: m[0], index: m.index });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

export function findInjectionPhrases(text: string): PhraseHit[] {
  return scan(text, INJECTION_PATTERNS);
}

export function findFetchExecute(text: string): PhraseHit[] {
  return scan(text, FETCH_EXECUTE_PATTERNS);
}

/** Base64-looking blobs ≥ minLength chars (SK405). */
export function findBase64Blobs(text: string, minLength: number): PhraseHit[] {
  const re = new RegExp(`[A-Za-z0-9+/]{${minLength},}={0,2}`, 'g');
  const hits: PhraseHit[] = [];
  for (const m of text.matchAll(re)) {
    hits.push({
      pattern: 'base64-blob',
      match: `${m[0].slice(0, 24)}… (${m[0].length} chars)`,
      index: m.index,
    });
  }
  return hits;
}
