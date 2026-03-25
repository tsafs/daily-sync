# Process a Plan Step

Execute a single step from the project's plan document through a structured multi-phase workflow. Each phase should be completed fully before moving to the next.

## Usage

Tell Copilot which step number and (optionally) which plan file:

> Process step 6 from PLAN.md

If no plan file is specified, default to `PLAN.md`.

---

## Phase 1 — Plan the Implementation

Read the plan document and focus on the specified step. Analyze the current codebase to understand what exists, what dependencies the step has, and what deliverables are expected.

Produce a detailed implementation checklist. For each item include:
- File(s) to create or modify (with paths)
- Concise description of the change
- New dependencies or packages to install
- Unit tests to write or update
- Integration / E2E tests (if applicable)
- Linting, formatting, and build steps (including Dockerfile rebuilds if touched)
- Any credentials, secrets, or external services required — flag these explicitly

If credentials or external access are needed, list them under a **"Required Credentials"** section. **Do NOT proceed to Phase 3 until the user confirms credentials are available or instructs you to skip them.**

Output the plan in Markdown. Do NOT begin implementation yet.

---

## Phase 2 — Review the Plan

Review the implementation plan from Phase 1 against these criteria:

1. **Completeness** — Covers all deliverables? Edge cases addressed?
2. **Correctness** — File paths, module names, API usages accurate for this codebase?
3. **Test coverage** — Unit tests for all new logic? Integration/E2E where external systems are involved?
4. **Build & quality gates** — Includes linting, formatting, type-checking, Docker builds (if applicable)?
5. **Credential handling** — All required credentials explicitly identified?
6. **Risk & dependencies** — Ordering constraints, breaking changes, upstream issues?
7. **Scope** — Stays within this single step? Doesn't bleed into other steps?

Present approved items and change requests. Give a verdict: **APPROVE**, **REVISE**, or **REJECT**.

If not APPROVE, revise the plan and re-review. Maximum 3 iterations — if still not approved, present the issues and ask how to proceed.

---

## Phase 3 — Execute the Plan

Implement the approved plan following these rules:

1. **Credential gate** — If any step requires credentials or external service access, **STOP and ask**. List exactly what is needed and why. Do NOT proceed, skip, or mock around missing credentials unless explicitly told to.

2. **Implementation** — Create and modify files as specified. Write clean, idiomatic code following existing project conventions.

3. **Unit tests** — Write or update unit tests for all new and modified logic. Run them and ensure they pass.

4. **Integration / E2E tests** — Write or update where specified. Run and ensure they pass. Stop and ask if credentials are missing.

5. **Linting & formatting** — Run the project's linter and formatter. Fix any issues.

6. **Type checking** — Run the type checker (if applicable). Fix any type errors.

7. **Build** — If Dockerfiles, build scripts, or compilation steps are affected, run the full build.

8. **No silent skips** — If any step cannot be completed, STOP and report the blocker.

Provide a summary: files changed, tests pass/fail, lint/build status, any open blockers.

---

## Phase 4 — Review the Changes

Review all changes made in Phase 3. Run `git diff` and perform a thorough code review:

1. **Correctness** — Matches the plan? Handles edge cases and errors?
2. **Code quality** — Clean, readable, idiomatic? Follows project conventions?
3. **Test quality** — Meaningful assertions? Covers happy, error, and edge cases?
4. **Security** — No credential leaks, injection risks, or insecure defaults?
5. **Performance** — No obvious issues (unnecessary allocations, O(n²), blocking I/O)?
6. **API & interface design** — Clean, consistent public interfaces?
7. **Documentation** — New functions documented? Config changes in README?
8. **Build & CI** — Dockerfiles and build scripts still work? Dependencies declared?

Produce:
- **Approved items** (no changes needed)
- **Change proposals** with severity (CRITICAL / IMPROVEMENT / NIT), file, location, issue, and suggested fix

---

## Phase 5 — Implement Feedback, Re-verify, and Summarize

Apply the review feedback:

1. **CRITICAL items** — Mandatory. If unresolvable, explain why.
2. **IMPROVEMENT items** — Apply unless disproportionate complexity/risk. Document skips.
3. **NITs** — Apply if trivial. Skip with a note if not.

**Re-run all quality gates:** unit tests, integration tests, lint, format, type-check, build.

Then produce a **final summary**:

- **Changes made** — All files created/modified/deleted with brief descriptions
- **Test results** — Unit and integration test counts, pass/fail
- **Build status** — Lint, format, type-check, build pass/fail
- **Trade-offs** — Decisions made and alternatives considered
- **Consequences** — Breaking changes, impact on other steps, tech debt, attention areas
- **Open items** — Anything incomplete and recommendations

---

## Phase 6 — Human Review

Present the summary and wait for approval. When approved, create a conventional commit:
- Message references the plan step (e.g., `feat: implement step N — <description>`)
- Stage only files changed by this workflow

## Key Principles

1. **Never skip quality gates.** Tests, lint, and builds must pass after every code-producing phase.
2. **Never assume credentials.** Ask and block until provided or overridden.
3. **Stay in scope.** Only implement the current step. Flag out-of-scope items as follow-ups.
4. **Transparency over speed.** Surface blockers immediately, don't make silent assumptions.
