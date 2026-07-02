import type { Rule } from '../../core/types.js';
import { definitionRules } from './definition.js';
import { protocolRules } from './protocol.js';
import { securityRules } from './security.js';
import { tokenRules } from './tokens.js';

// One module per dimension — see the allocation table in ../index.ts.
// MCP4xx (reliability, --probe) lands in a later PR.
export const mcpRules: Rule[] = [
  ...protocolRules,
  ...definitionRules,
  ...tokenRules,
  ...securityRules,
];
