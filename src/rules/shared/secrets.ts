/**
 * Secret-shaped string detection (SK403 / CTX006). Patterns are prefix +
 * charset + length so that clearly-fake test values (AKIAIOSFODNN7EXAMPLE,
 * ghp_...FAKE...) still match — we detect shapes, not live credentials.
 */

export interface SecretHit {
  kind: string;
  match: string;
  index: number;
}

const PATTERNS: ReadonlyArray<readonly [kind: string, re: RegExp]> = [
  ['AWS access key ID', /\bAKIA[0-9A-Z]{16}\b/g],
  ['GitHub personal access token', /\bghp_[A-Za-z0-9]{36}\b/g],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9-]{20,}/g],
  ['API secret key', /\bsk-[A-Za-z0-9]{20,}\b/g],
  ['Slack token', /\bxox[bp]-[A-Za-z0-9-]{10,}/g],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
];

export function findSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const claimed: Array<[number, number]> = [];
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      // sk-ant- keys also match the generic sk- pattern; first (more
      // specific) pattern wins for any overlapping span.
      if (claimed.some(([s, e]) => start < e && end > s)) continue;
      claimed.push([start, end]);
      hits.push({ kind, match: redact(m[0]), index: start });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Never echo a full secret-shaped string back into reports. */
function redact(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}
