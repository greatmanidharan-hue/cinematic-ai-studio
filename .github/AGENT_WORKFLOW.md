# Specialist Agent Workflow

Cinematic AI Studio uses focused specialist profiles in `.github/agents/` to make implementation, review, and validation responsibilities explicit.

## Specialist roster

| Profile | Responsibility | Editing |
|---|---|---|
| `studio-lead` | Breaks work into scoped tasks and coordinates integration | Yes |
| `software-architect` | Architecture, boundaries, and technical decision records | Read-only |
| `senior-developer` | Focused TypeScript/React implementation and regression tests | Yes |
| `vfx-specialist` | Effects, particles, transitions, and color grading | Yes |
| `performance-specialist` | Rendering, GPU, memory, and graceful fallback optimization | Yes |
| `reliability-engineer` | GPU recovery, cancellation, lifecycle, and failure handling | Yes |
| `code-reviewer` | Independent correctness, security, and maintainability review | Read-only |
| `qa-reviewer` | Regression analysis, test planning, and validation evidence | Read-only |
| `ui-ux-designer` | Editor workflows, interaction states, and accessibility specifications | Read-only |

## Safe execution model

1. The lead defines one narrowly scoped task with acceptance criteria and explicit file ownership.
2. Assign implementation work to a separate supported coding-agent session and a dedicated working branch/PR.
3. Never let two implementation sessions edit the same branch or overlapping files concurrently.
4. Architecture and UI/UX profiles provide recommendations before implementation when a task changes boundaries or user workflows.
5. Code review and QA are independent, read-only gates. They must inspect the actual diff and report evidence.
6. The lead resolves conflicts, checks CI, and integrates only after review.
7. Keep the existing foundation PR in draft until validation is complete. Never merge to `main` without explicit owner approval.

## Task contract

Every implementation task must state:
- Goal and user-visible behavior.
- In-scope files and explicit out-of-scope files.
- Acceptance criteria and failure cases.
- Tests to add and commands to run.
- Dependencies and files that must not be edited.
- Required report: changed files, commit/PR link, tests actually run, results, and known limitations.

Every review must state:
- Findings by severity with file/line references.
- Reproduction or failure scenario.
- Missing regression cases.
- What was and was not validated.
- Recommendation: approve, request changes, or needs more evidence.

## Parallelization rules

Good parallel tasks:
- A self-contained VFX preset or renderer feature.
- A separate browser-performance investigation.
- Read-only QA or code review of an already proposed diff.
- UI/UX specification work that does not overlap implementation files.

Do not parallelize:
- Multiple edits to the same renderer or shared type definitions.
- Changes that depend on an unfinished shared API.
- Layer-order or blend-mode changes without an agreed compositing specification.
- Multiple agents changing package configuration, lockfiles, or shared CI workflows simultaneously.

## Project guardrails

- Web/Core is the current priority. Android work is deferred.
- AI video generation is on hold. Do not add generation APIs, model calls, or paid-provider dependencies.
- Prefer browser-only processing.
- Preserve preview/export consistency.
- Never claim tests, benchmarks, or browser/GPU visual checks passed unless actually executed.
- Agent profiles are instruction files, not running processes. Actual parallel sessions must be started by a supported GitHub Copilot coding-agent environment or another explicitly configured agent runtime.
- Do not assume an agent was launched merely because its profile exists.

## Upstream inspiration

The role-based specialist approach was informed by [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents). The profiles in this repository are project-specific instructions, not wholesale copies of upstream agent files. See `THIRD_PARTY_NOTICES.md` for the upstream MIT license notice.
