# Phase Prompt Templates

These are the detailed prompts to pass to each subagent. Replace `STEP_NUMBER` with the actual step number and `PLAN_FILE` with the plan file path before delegating.

---

## Phase 1 — Plan the Implementation

```
Read the plan document at `PLAN_FILE` and focus on Step STEP_NUMBER.

Analyze the current codebase to understand:
- What already exists that is relevant to this step
- What dependencies (files, modules, packages, services) this step requires
- What the step's deliverables are

Produce a detailed implementation plan as a numbered checklist. For each item include:
- The file(s) to create or modify (with paths)
- A concise description of the change
- Any new dependencies or packages to install
- Unit tests to write or update
- Integration / E2E tests to write or update (if applicable)
- Linting, formatting, and build steps required (including Dockerfile rebuilds if touched)
- Any credentials, secrets, API keys, or external services required — flag these explicitly

If any credentials or external access are needed for testing or execution (e.g., server endpoints, API keys, SMTP credentials, Docker registry access), list them clearly under a "Required Credentials" section at the end.

Output the plan in Markdown. Do NOT begin implementation.
```

---

## Phase 2 — Review the Plan

```
Review the following implementation plan for Step STEP_NUMBER of the project plan (`PLAN_FILE`).

<implementation plan from Phase 1>

Evaluate against these criteria:

1. **Completeness** — Does it cover all deliverables described in the plan step? Are edge cases addressed?
2. **Correctness** — Are the proposed file paths, module names, and API usages accurate given the current codebase?
3. **Test coverage** — Are unit tests specified for all new logic? Are integration/E2E tests specified where external systems are involved?
4. **Build & quality gates** — Does the plan include linting, formatting, type-checking, and Docker builds (if applicable)?
5. **Credential handling** — Are all required credentials explicitly identified? Is there a clear gate that blocks execution until they are provided?
6. **Risk & dependencies** — Are there ordering constraints, breaking changes, or upstream dependencies that could cause issues?
7. **Scope** — Does the plan stay within the boundaries of this single step, or does it bleed into other steps?

Produce:
- A list of **approved items** (no changes needed)
- A list of **change requests** with specific, actionable suggestions
- A **verdict**: APPROVE, REVISE, or REJECT

If REVISE or REJECT, explain exactly what needs to change so the next iteration can address it.
```

---

## Phase 3 — Execute the Plan

```
Execute the approved implementation plan for Step STEP_NUMBER of the project plan (`PLAN_FILE`).

<approved plan from Phase 2>

Follow these rules strictly:

1. **Credential gate** — Before executing any step that requires credentials or external service access, STOP and ask the human to provide them. List exactly what is needed and why. Do NOT proceed, skip, or mock around missing credentials unless explicitly told to by the human.

2. **Implementation** — Create and modify files exactly as specified in the plan. Write clean, idiomatic code following existing project conventions (style, naming, structure).

3. **Unit tests** — Write or update unit tests for all new and modified logic. Run them and ensure they pass.

4. **Integration / E2E tests** — Write or update integration and E2E tests where the plan specifies them. Run them and ensure they pass. If they require credentials not yet provided, stop and ask (see rule 1).

5. **Linting & formatting** — Run the project's linter and formatter. Fix any issues introduced by the changes.

6. **Type checking** — Run the type checker (if applicable). Fix any type errors.

7. **Build** — If Dockerfiles, build scripts, or compilation steps are affected, run the full build and ensure it succeeds.

8. **No silent skips** — If any step cannot be completed (missing tool, failing test, unclear requirement), STOP and report the blocker. Do NOT silently skip it.

After execution, provide a summary of:
- Files created / modified / deleted
- Tests added / modified and their pass/fail status
- Lint / format / build status
- Any blockers encountered and how they were resolved (or if they remain open)
```

---

## Phase 4 — Review the Changes

```
Review all changes made during execution of Step STEP_NUMBER from `PLAN_FILE`.

Run `git diff` to see all changes, then perform a thorough code review covering:

1. **Correctness** — Does the implementation match the approved plan? Does the logic handle edge cases and error conditions?
2. **Code quality** — Is the code clean, readable, and idiomatic? Does it follow existing project conventions?
3. **Test quality** — Are the tests meaningful (not just asserting trivially)? Do they cover happy paths, error paths, and edge cases? Is test isolation maintained?
4. **Security** — Are there any credential leaks, injection risks, or insecure defaults?
5. **Performance** — Are there obvious performance issues (unnecessary allocations, O(n²) where O(n) is possible, blocking I/O in hot paths)?
6. **API & interface design** — Are public interfaces clean and consistent? Are breaking changes documented?
7. **Documentation** — Are new functions/modules documented where needed? Are config changes reflected in README or env var references?
8. **Build & CI** — Do Dockerfiles, build scripts, and CI configs still work? Are dependencies properly declared?

Produce:
- A list of **approved items** (no changes needed)
- A list of **change proposals** — each with:
  - Severity: CRITICAL (must fix), IMPROVEMENT (should fix), NIT (optional)
  - File and location
  - Description of the issue
  - Suggested fix
- An overall assessment
```

---

## Phase 5 — Implement Feedback, Re-verify, and Summarize

```
Implement the feasible change proposals from the code review of Step STEP_NUMBER (`PLAN_FILE`).

<code review output from Phase 4>

Follow these rules:

1. **Implement all CRITICAL items** — These are mandatory. If any cannot be resolved, STOP and explain why.

2. **Implement IMPROVEMENT items** — Apply these unless doing so would introduce disproportionate complexity or risk. If you skip one, document why.

3. **NITs are optional** — Apply them if trivial. Skip with a brief note if not.

4. **Re-run all quality gates after changes:**
   - Unit tests — run and confirm all pass
   - Integration / E2E tests — run and confirm all pass (respect credential gates)
   - Linting & formatting — run and fix any issues
   - Type checking — run and fix any errors
   - Build — run full build (including Docker if applicable) and confirm success

5. **Final summary** — After all changes and verification, produce a comprehensive summary:

   **Changes made:**
   - List all files created, modified, or deleted across Phases 3 and 5
   - Briefly describe each change

   **Test results:**
   - Unit test count and pass/fail
   - Integration/E2E test count and pass/fail (or note if skipped due to missing credentials)

   **Build status:**
   - Lint, format, type-check, build — pass/fail for each

   **Trade-offs and design decisions:**
   - Any trade-offs made during implementation and why
   - Alternative approaches considered but not taken

   **Consequences and follow-up:**
   - Breaking changes (if any) and migration notes
   - Impact on other plan steps
   - Technical debt introduced (if any)
   - Things the human reviewer should pay special attention to

   **Open items:**
   - Anything that could not be completed and why
   - Recommendations for future work related to this step
```
