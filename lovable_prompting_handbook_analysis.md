# Lovable Prompting Handbook Analysis

Source: https://lovable.dev/blog/2025-01-16-lovable-prompting-handbook

Analysis date: 2026-06-12

## Scoring Rubric

`Prod Score` measures how production-ready the original prompt is today on a 1-10 scale.

`Impact` measures the expected value of improving the prompt for real product/codebase work on a 1-10 scale.

## Prompt Audit Matrix

| Rank | Prompt / Area | Prod Score | Impact | Main Production Gaps | Production-Grade Improvement |
|---:|---|---:|---:|---|---|
| 1 | Rethink and Rebuild | 8 | 10 | Strong investigation prompt, but needs explicit evidence format, reproduction criteria, and decision gates. | Require repro steps, observed vs expected, dependency map, root-cause confidence, rollback risk, and no implementation until approved. |
| 2 | Comprehensive Audit Debugging | 8 | 10 | Good pause-and-map instruction, but lacks severity ranking and verification plan. | Add severity, affected users/features, logs used, unknowns, and minimum proof needed before fixes. |
| 3 | Full System Review | 8 | 10 | Strong scope, but could be too broad without boundaries. | Define exact flows, entry points, environments, data stores, auth/session assumptions, and expected deliverable format. |
| 4 | Deep Analysis | 8 | 10 | Good anti-speculation rule, but no reproducibility requirement. | Add reproduction command, evidence links, hypothesis table, eliminated causes, and final confidence score. |
| 5 | Initial Investigation | 7 | 10 | Useful, but vague on “logs, workflows, dependencies.” | Specify files, console/network logs, backend logs, recent changes, failing test, and no code edits. |
| 6 | Codebase Structure Audit Prompt | 9 | 9 | Already strong, but needs prioritization by risk and business impact. | Add architecture boundaries, dependency graph, severity, effort, owner area, and phased migration plan. |
| 7 | Comprehensive Refactoring | 8 | 9 | Good planning, but lacks measurable acceptance criteria. | Require unchanged UI snapshots, test matrix, risk register, file-by-file refactor candidates, and rollback plan. |
| 8 | Post Refactoring | 8 | 9 | Good validation intent, but overly broad test language. | Name exact tests: unit, integration, E2E, visual diff, accessibility smoke, build/typecheck. |
| 9 | Refactoring After Request | 8 | 9 | Solid, but “pause if uncertain” is not operational. | Add incremental patches, behavior inventory, before/after checklist, and explicit no-UI-change constraint. |
| 10 | Refactoring Planning | 8 | 9 | Good, but should demand dependency and side-effect analysis. | Add import graph, state/API dependencies, test gaps, hidden coupling, and migration order. |
| 11 | Diff & Select | 8 | 9 | Strong intent to minimize changes, but missing file scope. | Add “edit only listed files unless you explain why,” include regression checklist, and require before-edit plan. |
| 12 | Lock Files | 6 | 9 | Useful but brittle; “pages X/Y” may miss shared dependencies. | Add protected files/components/routes, allowed files, forbidden side effects, and dependency exceptions requiring approval. |
| 13 | Delicate Update | 7 | 9 | Good caution, but lacks concrete acceptance criteria. | Add exact feature behavior to preserve, tests to run, files off-limits, and approval gate for uncertain changes. |
| 14 | Post Restructuring Cleanup | 8 | 9 | Good routing/import focus, but lacks automated verification. | Add route inventory, import validation, dead-file scan, build/typecheck, navigation smoke test, and 404 audit. |
| 15 | Codebase Check for Refactoring | 8 | 8 | Strong audit prompt, but overlaps with other audit prompts. | Consolidate with structure audit and add concrete scoring for coupling, cohesion, duplication, and testability. |
| 16 | Folder Review | 8 | 8 | Good, but should avoid deletion without impact analysis. | Add import/dependency checks, usage frequency, safe-delete criteria, and “do not modify files.” |
| 17 | Stripe Setup | 7 | 8 | Good security note, but incomplete for production payments. | Add test/live mode distinction, idempotency, webhook verification, entitlement update, error handling, retries, and secret handling. |
| 18 | UI Changes | 8 | 8 | Good functionality-preservation instruction, but no visual acceptance criteria. | Add target pages/components, before/after screenshots, responsive states, accessibility, and no data/state changes. |
| 19 | Optimize for Mobile | 8 | 8 | Good planning/testing language, but lacks device matrix. | Add viewport list, touch targets, keyboard behavior, overflow checks, and mobile performance constraints. |
| 20 | Mobile First Combined | 8 | 8 | Strong, but bundles too many requirements. | Split into plan, implementation, and verification phases with breakpoints and protected behavior. |
| 21 | Responsiveness Planning | 8 | 8 | Good read-only planning prompt. | Add breakpoint inventory, high-risk layouts, affected components, and test checklist before implementation. |
| 22 | Responsiveness and Breakpoints | 7 | 8 | Good but too implementation-directive without app context. | Add target screens, existing design constraints, Tailwind breakpoint mapping, and acceptance criteria. |
| 23 | Clean up Console Logs | 8 | 7 | Strong plan-first prompt. | Add distinction between debug logs, audit/security logs, error reporting, and production observability. |
| 24 | Confirming Findings | 7 | 7 | Good sanity check, but needs evidence standard. | Ask for confidence level, contrary evidence, untested assumptions, and exact root-cause proof. |
| 25 | Checking Complexity | 7 | 7 | Useful simplification gate, but generic. | Require simpler alternatives, tradeoff table, deleted complexity, risk comparison, and recommendation. |
| 26 | Explaining Errors | 7 | 7 | Good no-edit diagnostic prompt. | Add stack trace interpretation, likely source file/function, reproduction context, and next diagnostic step. |
| 27 | “Use chain-of-thought reasoning…” Debug Prompt | 5 | 7 | Requests hidden reasoning; not ideal for modern AI systems. | Replace with “provide concise root-cause analysis, evidence, assumptions, and next verification steps.” |
| 28 | What Solutions Tried So Far? | 6 | 7 | Useful, but under-specified. | Ask for attempted fixes, why each failed, remaining hypotheses, safest next test, and rollback point. |
| 29 | Analyze Error and Alternative Approach | 6 | 7 | Good fallback, but too vague. | Include error text, current implementation, constraints, alternatives with pros/cons, and recommended path. |
| 30 | Why Is This UI Behaving This Way? | 5 | 7 | Needs screenshot/context and DOM/CSS inspection instructions. | Ask for root cause across layout, CSS, state, data, viewport, and exact minimal fix. |
| 31 | Knowledge Base Review | 8 | 7 | Good read-only comprehension gate. | Add request for assumptions, missing requirements, conflicts, and implementation risks before coding. |
| 32 | Starting New Project | 7 | 7 | Good structure but incomplete for production. | Add users/personas, auth roles, data model, non-functional requirements, deployment target, analytics, and security. |
| 33 | Project/User Flow Example | 5 | 6 | Too skeletal. | Expand to include roles, entry/exit states, permissions, error states, empty states, and route map. |
| 34 | Step by Step | 6 | 6 | Good sequencing, but too informal and has typo. | Convert into phased plan: UI skeleton, routing, data model, backend integration, validation, UX polish. |
| 35 | Key Guidelines / Details | 6 | 6 | Good behavioral instruction, but not task-specific. | Add requirement to ask clarifying questions only when blocked, cite files, and provide acceptance criteria. |
| 36 | Meta Prompting: Rewrite Login Prompt | 6 | 6 | Useful but asks only for concise/detail, not production quality. | Ask to improve for security, architecture, auth flows, validation, errors, tests, and deployment constraints. |
| 37 | Reverse Meta Prompting JWT | 7 | 6 | Good learning loop, but lacks reusable structure. | Output as incident summary, root cause, fix, prevention, reusable prompt, and checklist. |
| 38 | Default Mode: Outdated Code | 5 | 6 | Too broad. | Define “outdated”: deprecated APIs, vulnerable deps, dead code, anti-patterns, framework mismatches, priority ranking. |
| 39 | Chat Mode: Follow This Plan | 4 | 6 | Dangerous without plan validation. | Add “first validate the plan, identify risks, ask about blockers, then proceed step-by-step after approval.” |
| 40 | Super Prompt: Architecture Audit | 8 | 6 | Strong but duplicated by other audit prompts. | Merge with report prompt and require actionable file-level findings. |
| 41 | Super Prompt: Enhancement Report | 8 | 6 | Strong but depends on previous prompt context. | Combine with audit prompt so findings and recommendations are produced together. |
| 42 | “Don’t Give Me High-Level Stuff” Preference Prompt | 6 | 5 | Useful style preference, but too aggressive and includes broad unrelated instructions. | Reduce to concise response contract: direct answer, concrete code/steps, assumptions, risks, sources at end. |
| 43 | Enhance Prompt | 4 | 5 | Not actually a prompt; vague instructions. | Replace with a reusable prompt template requiring goal, context, constraints, files, acceptance criteria, and test plan. |
| 44 | Training Wheels Structure | 5 | 5 | Useful format, but empty labels alone are insufficient. | Add required fields under each heading: context, objective, scope, constraints, acceptance criteria, verification. |
| 45 | World-Class Prompt Engineer App Prompt | 4 | 5 | Meta-prompt is vague; no stack, users, data, quality constraints. | Specify target app, stack, roles, report inputs/outputs, data sources, UI, security, tests, and deployment. |
| 46 | Implementation Order: Create Pages Before DB | 5 | 5 | Good sequencing advice, but not universally correct. | Add context-specific implementation order with milestones and validation gates. |
| 47 | Encouragement Prompt | 2 | 2 | Morale text has little production utility and wastes prompt budget. | Replace with concrete quality bar: be careful, evidence-based, concise, verify before changing code. |

## Highest-Impact Production Pattern

```text
Before editing any code, investigate and produce a concise implementation plan.

Include:
1. Current behavior vs expected behavior.
2. Relevant files, components, APIs, state, routes, and dependencies.
3. Root cause or implementation objective with evidence.
4. Risks, edge cases, and protected behavior that must not change.
5. Minimal file-scope proposal.
6. Test/validation checklist, including build, typecheck, unit/integration/E2E, responsive, and regression checks where relevant.
7. Open questions that block safe implementation.

Do not modify files until the plan is reviewed or approval is given.
```

## Best Reusable Production Implementation Prompt

```text
Implement the requested change with the smallest safe diff.

Constraints:
- Preserve existing behavior unless explicitly listed as changing.
- Edit only necessary files; explain before touching unrelated files.
- Do not introduce new dependencies unless justified.
- Keep UI, routes, state, data contracts, and API behavior stable unless specified.
- Add or update tests where the change affects behavior.

Before coding, briefly identify the files involved, risks, and acceptance criteria.
After coding, run the relevant validation steps and report what passed or could not be run.
```

## Recommended Prompt Template

```text
# Objective
[Describe the exact outcome.]

# Context
[Describe the product, affected feature, users, routes, APIs, and current behavior.]

# Scope
[List files, pages, components, workflows, or integrations that may be changed.]

# Out of Scope
[List protected behavior, pages, files, APIs, data contracts, or designs that must not change.]

# Constraints
[Mention stack, design system, performance, security, accessibility, auth, data, or compliance constraints.]

# Acceptance Criteria
[List observable pass/fail criteria.]

# Verification
[List required tests, build/typecheck, manual flows, screenshots, logs, or API checks.]

# Output Format
[Specify whether you want a plan, code changes, audit report, matrix, or final summary.]
```
