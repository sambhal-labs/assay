import type { Rule } from '../../core/types.js';
import { securityRules } from './security.js';
import { structureRules } from './structure.js';

// One module per dimension — see the allocation table in ../index.ts.
export const skillRules: Rule[] = [...structureRules, ...securityRules];
