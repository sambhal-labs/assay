/**
 * Hidden/obfuscating Unicode detection (SK402 / MCP302 / CTX006).
 *
 * Allowlist-of-badness: only specific invisible or direction-manipulating
 * codepoints are flagged — legitimate non-ASCII prose (German, Japanese,
 * emoji) must never produce a finding. LRM/RLM (U+200E/F) and soft hyphen
 * (U+00AD) are deliberately excluded: they appear in legitimate RTL and
 * typographic text.
 */

export type HiddenUnicodeKind = 'zero-width' | 'bidi' | 'tag' | 'bom';

export interface HiddenUnicodeHit {
  kind: HiddenUnicodeKind;
  codePoint: number;
  /** U+XXXX form for messages. */
  label: string;
  index: number;
}

function classify(cp: number): HiddenUnicodeKind | null {
  if (cp >= 0x200b && cp <= 0x200d) return 'zero-width';
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return 'bidi';
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'tag';
  if (cp === 0xfeff) return 'bom';
  return null;
}

export function findHiddenUnicode(text: string): HiddenUnicodeHit[] {
  const hits: HiddenUnicodeHit[] = [];
  let index = 0;
  // Iterate by code point: the tag block is astral, charCodeAt would split it.
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const kind = classify(cp);
    // A BOM at byte 0 is a legitimate encoding artifact, not obfuscation.
    if (kind && !(kind === 'bom' && index === 0)) {
      hits.push({
        kind,
        codePoint: cp,
        label: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
        index,
      });
    }
    index += ch.length;
  }
  return hits;
}
