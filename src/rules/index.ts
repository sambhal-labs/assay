import type { Rule, RuleMeta } from '../core/types.js';
import { contextRules } from './context/index.js';
import { mcpRules } from './mcp/index.js';
import { skillRules } from './skill/index.js';

/**
 * Rule ID allocation — every built-in rule, its dimension, and its default
 * severity. Family barrels own their IDs; this table is the collision-free
 * source of truth for contributors. docs/RULES.md is generated from the
 * registered metadata (`npm run gen:docs`), never hand-edited.
 *
 * Skill — structure (SK0xx):
 *   SK001 error  SKILL.md missing/unreadable
 *   SK002 error  frontmatter missing/invalid or missing name/description
 *   SK003 warn   name not kebab-case / >64 chars / mismatches directory
 *   SK004 info   unknown frontmatter keys
 *   SK005 warn   referenced resource files missing on disk
 *   SK006 warn   absolute local filesystem paths in body
 * Skill — trigger quality (SK1xx):
 *   SK101 error  description too short or placeholder
 *   SK102 warn   description > budget chars
 *   SK103 warn   no usage guidance ("use when...")
 *   SK104 warn   no concrete action verbs
 *   SK105 info   first-person phrasing
 *   SK106 warn   description similar to sibling skill (repo scope)
 * Skill — token efficiency (SK2xx):
 *   SK201 info   body > info budget tokens
 *   SK202 warn   body > warn budget tokens
 *   SK203 warn   monolith: long body with zero companion links
 *   SK204 info   large inline code blocks
 *   SK205 warn   boilerplate the model already knows
 * Skill — instruction quality (SK3xx):
 *   SK301 warn   no imperative step structure
 *   SK302 info   no validation/verification step
 *   SK303 info   no failure-path guidance
 *   SK304 warn   contradictory absolute modifiers
 * Skill — security (SK4xx, securityCap):
 *   SK401 error  injection-pattern phrases
 *   SK402 error  hidden/obfuscating unicode
 *   SK403 error  secret-shaped strings
 *   SK404 warn   fetch-and-execute instructions
 *   SK405 warn   base64 blob in instructions
 *   SK406 info   hardcoded non-major domains in scripts
 * MCP — protocol (MCP0xx):
 *   MCP001 error initialize fails/times out
 *   MCP002 error tools/list fails or malformed entries
 *   MCP003 warn  protocol version/capabilities incomplete
 *   MCP004 info  deprecated transport hints
 * MCP — definition quality (MCP1xx):
 *   MCP101 error tool missing/empty description
 *   MCP102 warn  description too short/generic
 *   MCP103 error input schema missing/empty while description implies params
 *   MCP104 warn  parameters missing descriptions
 *   MCP105 warn  enum-in-prose instead of enum schema
 *   MCP106 warn  no required array despite mandatory-sounding params
 *   MCP107 info  tool name style/length/collision
 *   MCP108 warn  tool count > budget
 * MCP — token cost (MCP2xx):
 *   MCP201 info|warn per-tool schema token cost over budget
 *   MCP202 warn  total server context tax over budget (with $ translation)
 *   MCP203 info  verbose JSON-Schema anti-patterns
 * MCP — security (MCP3xx, securityCap):
 *   MCP301 error injection phrases in tool/param descriptions
 *   MCP302 error hidden unicode in tool metadata
 *   MCP303 warn  cross-tool steering references
 *   MCP304 warn  reads files/env unrelated to stated purpose
 *   MCP305 info  name similar to well-known server/tool
 * MCP — reliability (MCP4xx, --probe only):
 *   MCP401 warn  protocol error on schema-valid call
 *   MCP402 info  p95 latency over budget
 *   MCP403 warn  unstructured error responses
 * Context files (CTX0xx, single quality dimension; CTX006 securityCap x2):
 *   CTX001 info|warn token count over budget
 *   CTX002 warn  references files that don't exist
 *   CTX003 warn  references commands not in package scripts
 *   CTX004 warn  contradictory absolute rules
 *   CTX005 info  generic filler sections
 *   CTX006 error shared security detectors
 */
export const allRules: Rule[] = [...skillRules, ...mcpRules, ...contextRules];

const byId = new Map<string, Rule>(allRules.map((r) => [r.meta.id, r]));

export function ruleMetaById(id: string): RuleMeta | undefined {
  return byId.get(id)?.meta;
}
