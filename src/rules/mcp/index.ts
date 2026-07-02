import type { Rule } from '../../core/types.js';
import { definitionRules } from './definition.js';
import { protocolRules } from './protocol.js';
import { reliabilityRules } from './reliability.js';
import { securityRules } from './security.js';
import { tokenRules } from './tokens.js';

// One module per dimension — see the allocation table in ../index.ts.
// MCP4xx (reliability) only produce findings when --probe populated
// artifact.probe.
export const mcpRules: Rule[] = [
  ...protocolRules,
  ...definitionRules,
  ...tokenRules,
  ...securityRules,
  ...reliabilityRules,
];
