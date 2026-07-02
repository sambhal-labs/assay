# Fixtures

Test artifacts for assay's own rule suite. Each `skills/<tier>/` directory is a
skill at a deliberate quality level:

- `skills/exemplary/` — a well-structured skill that should grade near the top.
- `skills/mediocre/` — valid but padded and vague: over the token budget, no
  trigger guidance, no step structure, three dead companion links.
- `skills/broken/` — malformed frontmatter and a dead link.
- `skills/malicious/` — deliberately well-written so that its grade is decided
  purely by the security cap. It embeds injection phrasing, hidden Unicode,
  secret-shaped strings, a fetch-and-execute line, and a base64 blob.

## Every "secret" in here is fake

All credentials, injection phrases, encoded blobs, and invisible characters in
these fixtures are **synthetic test data** that exist so assay's detectors have
something to detect. None of them are, or ever were, live:

- `AKIAIOSFODNN7EXAMPLE` is AWS's own documented example access key ID.
- `ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE1234` is a made-up string that merely
  matches the GitHub token shape.
- The base64 blob decodes to lorem ipsum.
- `https://evil.example.com` uses the IANA-reserved `example.com` domain.

Secret scanners: treat everything under `fixtures/` as allowlisted test data
(`gitleaks:allow` markers are embedded next to each payload). Do not "fix" or
rotate anything here.

## Do not normalize these files

`fixtures/` is excluded from Prettier and marked `-text` in `.gitattributes`
because the malicious fixture carries invisible Unicode (U+200B, U+202E, a
tag-block codepoint) and exact line layouts that the rules must detect.
Editors and formatters that strip or normalize them silently break the suite;
`test/fixture-integrity.test.ts` exists to catch exactly that.
