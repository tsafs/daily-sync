---
name: process-plan-step
description: Execute a single step from a plan document through a structured multi-phase workflow with planning, review, execution, code review, and finalization. Invoke manually when ready to work on a plan step.
disable-model-invocation: true
argument-hint: <step-number> [plan-file]
---

# Process a Plan Step

Execute step **$0** from the plan document (`$1`, default: `PLAN.md`) through five sequential phases. Each phase runs in a **foreground subagent** to isolate context. Orchestrate from the main conversation — do NOT attempt all phases in a single subagent.

## Arguments

- `$0` — Step number to process (required)
- `$1` — Path to the plan file (optional, defaults to `PLAN.md`)

## Workflow

Read the plan file first to confirm step $0 exists, then execute phases 1–5 in order. Each phase delegates to a foreground subagent with a specific prompt. Pass the phase output as context to the next phase.

### Phase 1 — Plan the Implementation

Spawn a **foreground subagent** with the Phase 1 prompt from [phases.md](phases.md). The subagent analyzes the codebase and produces a detailed implementation checklist. It must NOT implement anything.

**Tools needed:** Read-only (Read, Grep, Glob, Bash for non-destructive commands like `ls`, `cat`, `find`)

**Output:** Markdown implementation plan with a "Required Credentials" section if any external access is needed.

### Phase 2 — Review the Plan

Spawn a **foreground subagent** with the Phase 2 prompt from [phases.md](phases.md), passing the Phase 1 output as context.

**Tools needed:** Read-only (Read, Grep, Glob)

**Output:** Review with verdict: APPROVE, REVISE, or REJECT.

**Loop:** If not APPROVE, return to Phase 1 with the feedback incorporated. Repeat until approved. Cap at 3 iterations — if still not approved after 3 rounds, present the issues to the human and ask how to proceed.

### Phase 3 — Execute the Plan

Spawn a **foreground subagent** with the Phase 3 prompt from [phases.md](phases.md), passing the approved plan as context. This subagent has full tool access and will create/modify files, run tests, lint, and build.

**Tools needed:** All tools (Read, Write, Edit, Bash, Grep, Glob)

**Critical:** The subagent MUST stop and ask the human if credentials or external service access are needed and not available. It must NOT skip, mock around, or proceed without them.

**Output:** Implemented changes + execution summary.

### Phase 4 — Review the Changes

Spawn a **foreground subagent** with the Phase 4 prompt from [phases.md](phases.md). The subagent performs a thorough code review of all changes made in Phase 3.

**Tools needed:** Read-only (Read, Grep, Glob, Bash for `git diff` and non-destructive commands)

**Output:** Code review with categorized change proposals (CRITICAL / IMPROVEMENT / NIT).

### Phase 5 — Implement Feedback, Re-verify, and Summarize

Spawn a **foreground subagent** with the Phase 5 prompt from [phases.md](phases.md), passing the Phase 4 review as context. This subagent applies fixes, re-runs all quality gates, and produces the final summary.

**Tools needed:** All tools (Read, Write, Edit, Bash, Grep, Glob)

**Output:** Updated changes + comprehensive summary covering changes, trade-offs, consequences, and open items.

### Phase 6 — Present for Human Review

After Phase 5 completes, present the final summary to the human. Include:
- A concise diff overview (files changed, lines added/removed)
- The Phase 5 summary (changes, test results, build status, trade-offs, open items)
- A clear prompt: "Ready for your review. When you're satisfied, ask me to commit."

When the human approves, create a conventional commit:
- Message references the plan step (e.g., `feat: implement step N — <brief description>`)
- Stage only files changed by this workflow
- Do NOT include unrelated changes

## Key Principles

1. **Never skip quality gates.** Every phase that produces code must also produce passing tests, clean lint, and a successful build.
2. **Never assume credentials.** If a step requires external access, ask and block until provided or overridden.
3. **Fresh context per phase.** Each subagent starts clean. Pass necessary context explicitly.
4. **Stay in scope.** Only implement what the current plan step requires. Flag out-of-scope items as follow-up notes.
5. **Transparency over speed.** Surface blockers immediately rather than making silent assumptions.
