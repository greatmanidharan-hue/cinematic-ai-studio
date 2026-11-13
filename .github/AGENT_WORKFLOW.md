# Parallel Agent Workflow

This repository defines specialist agent profiles in `.github/agents/`.

## Roles

- `studio-lead`: breaks down work, owns integration decisions, and coordinates reviews.
- `vfx-specialist`: owns visual-effect implementation tasks.
- `performance-specialist`: owns browser rendering, WebGL, Canvas2D, memory, and fallback tasks.
- `qa-reviewer`: read-only independent review and test planning.

## Safe parallel execution

1. The lead creates one narrowly scoped issue per independent task.
2. Assign each implementation issue to a separate Copilot coding-agent session and select the matching custom agent profile where the GitHub UI offers that option.
3. Each implementation session must use its own working branch and pull request. Never have two agents edit the same branch concurrently.
4. Give each issue explicit file ownership. If two tasks need the same file, serialize those tasks.
5. The QA reviewer reviews each pull request read-only and reports findings before integration.
6. The lead resolves conflicts, checks CI, and integrates changes only after review.
7. Keep the existing foundation PR in draft until validation is complete. Never merge to `main` without explicit owner approval.

## Task issue format

Every agent task must state:
- Goal and user-visible behavior.
- In-scope files and explicit out-of-scope files.
- Acceptance criteria.
- Tests to add or run.
- Dependencies and files that must not be edited.
- Required report: changed files, commit/PR link, tests actually run, results, and known limitations.

## Parallelization rules

Good parallel tasks:
- A self-contained VFX preset or renderer feature.
- A separate browser-performance investigation.
- Read-only QA review of an already proposed diff.

Do not parallelize:
- Multiple edits to the same renderer or shared type definitions.
- Changes that depend on an unfinished shared API.
- Layer-order or blend-mode changes without an agreed compositing specification.

## Project guardrails

- AI video generation is on hold. Do not add generation APIs, model calls, or paid-provider dependencies.
- Prefer browser-only processing.
- Preserve preview/export consistency.
- Never claim tests, benchmarks, or browser/GPU visual checks passed unless actually executed.
- Agent profiles are instructions, not running processes. Actual parallel sessions must be started by a supported GitHub Copilot coding-agent environment or another explicitly configured agent runtime.
