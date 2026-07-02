import { z } from 'zod';
// Bundled into dist by tsup so the installed CLI carries its own corpus.
import corpusJson from '../../fixtures/distractors/skills-corpus.json' with { type: 'json' };

export const DistractorSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});
export type Distractor = z.infer<typeof DistractorSchema>;

const CorpusSchema = z.array(DistractorSchema).min(12);

/** The authored distractor corpus, shape-checked once per process. */
export function loadCorpus(): Distractor[] {
  return CorpusSchema.parse(corpusJson);
}
