import type { Rule } from '../../core/types.js';
import { ctxRules } from './rules.js';

// One module for the single quality dimension — see the allocation table in ../index.ts.
export const contextRules: Rule[] = [...ctxRules];
