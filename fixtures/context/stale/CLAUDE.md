# CLAUDE.md

Guidance for agents working on the acme-worker repository.

## Entry point

The job runner starts in `src/old/main.py` and fans work out to the queue
consumers. Runtime configuration is read from `src/config.py` at startup.

## Commands

- `npm run build` — bundle the worker
- `npm run test` — run the unit suite
- `npm run deploy` — push the current build to staging
