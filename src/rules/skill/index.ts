import type { Rule } from '../../core/types.js';
import { instructionRules } from './instruction.js';
import { securityRules } from './security.js';
import { structureRules } from './structure.js';
import { tokenRules } from './tokens.js';
import { triggerRules } from './trigger.js';

// One module per dimension — see the allocation table in ../index.ts.
export const skillRules: Rule[] = [
  ...structureRules,
  ...triggerRules,
  ...tokenRules,
  ...instructionRules,
  ...securityRules,
];
