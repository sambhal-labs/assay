/**
 * Prompt templates and the negative-request bank for the trigger-accuracy
 * eval. Bump PROMPTS_VERSION whenever any template or bank entry changes —
 * it is part of the cache key, so stale cached judge responses never get
 * replayed against new prompts.
 */
export const PROMPTS_VERSION = 1;

export interface RoutingSkill {
  name: string;
  description: string;
}

/** Asks the judge to write realistic requests the target skill SHOULD serve. */
export function positivesPrompt(skill: RoutingSkill, count: number): string {
  return [
    'You are helping evaluate whether an AI assistant loads the right skill at the right time.',
    '',
    'Target skill:',
    `  name: ${skill.name}`,
    `  description: ${skill.description}`,
    '',
    `Write ${count} realistic user requests that this skill SHOULD handle. Vary phrasing,`,
    'specificity, and length the way real users do: some terse, some detailed. Never',
    'mention the skill by name.',
    '',
    `Answer with ONLY a JSON array of ${count} strings. No prose, no code fences.`,
  ].join('\n');
}

/** One routing scenario: the full skill list plus a single user request. */
export function routingPrompt(skills: RoutingSkill[], userRequest: string): string {
  const list = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  return [
    'You are an AI assistant that may load exactly one skill to handle a user request,',
    'or none when no skill clearly applies. Available skills:',
    '',
    list,
    '',
    'User request:',
    userRequest,
    '',
    'Which skill, if any, should be loaded? Answer with ONLY a JSON object, no prose:',
    '{"skill": "<name>"} or {"skill": null}',
  ].join('\n');
}

/**
 * One negative user request per corpus distractor: a request squarely aimed
 * at THAT skill, which the target must not claim. Keyed by corpus name;
 * test/eval/corpus.test.ts asserts full coverage.
 */
export const NEGATIVE_BANK: Record<string, string> = {
  'code-review':
    'Can you review this pull request and flag anything that could break in production?',
  'spreadsheet-analysis':
    "Here's our Q3 sales spreadsheet — which region had the biggest month-over-month drop?",
  'calendar-booking':
    "Find 30 minutes next week that works for me, Priya, and Tomás — we're in three time zones.",
  'image-editing': 'Strip the background out of this product photo and export a 512x512 PNG.',
  'k8s-debugging':
    'My pods keep going into CrashLoopBackOff after the last deploy — help me figure out why.',
  'sql-query-builder':
    'Write a Postgres query that returns the top 10 customers by lifetime revenue.',
  'web-scraping': 'Pull the product names and prices from this listings page into a CSV.',
  'document-translation':
    'Translate this onboarding guide into Brazilian Portuguese but keep the markdown intact.',
  'git-workflows':
    'I botched an interactive rebase and now main has duplicate commits — how do I untangle this?',
  'pdf-processing': 'Combine these five PDFs into one and pull out the tables from pages 4-9.',
  'email-triage':
    "Go through today's unread email and tell me which three actually need a reply from me.",
  'ci-pipeline-doctor':
    'Our GitHub Actions build started failing on the lint step overnight with no code changes — diagnose it.',
  'data-visualization':
    'Turn this churn data into a line chart comparing the 2024 and 2025 cohorts over 12 months.',
  'docs-search': 'Search our internal docs for the runbook on rotating the staging TLS certs.',
  'regex-builder':
    'I need a regex that matches ISO 8601 timestamps but rejects dates without a timezone.',
  'api-mocking':
    'Spin up a mock of our /orders API that returns realistic fake data for the demo tomorrow.',
  'log-analysis': "Here's a week of nginx logs — find the IPs hammering /login with 401s.",
  'resume-screening':
    'Screen these 40 resumes against the senior backend JD and shortlist the top five.',
  'meeting-notes':
    'Summarize this hour-long planning call into decisions and action items with owners.',
  'dependency-audit': 'Check our package.json for known CVEs and anything GPL-licensed.',
  'i18n-localization':
    'Extract the hardcoded UI strings in these React components into locale files.',
  'dockerfile-optimizer':
    'My Docker image is 2.3 GB — get it under 400 MB without breaking the build.',
  'unit-test-generation':
    'Write unit tests for this payment module, especially the retry edge cases.',
  'financial-modeling':
    'Build a three-year revenue projection assuming 12% monthly growth and 8% churn.',
  'terraform-review':
    'Review this Terraform plan and tell me if anything will recreate the prod database.',
  'accessibility-audit': 'Audit our signup flow for WCAG 2.2 AA violations before the launch.',
  'changelog-writer': 'Draft release notes for v2.4 from the merged PRs since the last tag.',
  'slide-deck-builder': 'Turn this product brief into a 10-slide pitch deck outline for Friday.',
  'database-migration':
    'Write a migration that splits users.name into first and last name without downtime.',
  'incident-postmortem': "Draft a blameless postmortem for yesterday's 40-minute checkout outage.",
};
