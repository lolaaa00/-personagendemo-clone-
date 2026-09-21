# State assessment — 2026-09-21

**HEAD:** `c6e8cda` on `main` · **0 ahead / 0 behind `origin/main`** · clean tree, one worktree, no stashes, nothing staged
**Method:** git state, file:line reads and the gates run on 2026-09-21. The six assessments of the last fortnight are treated as *claims to re-check*, not as findings. Where a grep was ambiguous it was resolved by reading the code; where a claim could not be verified from this machine it is marked as such.
**Corpus this grounds against:** [fannabe](../competitive/fannabe-viability-assessment-2026-09-09.md) · [realism-chain feasibility](../competitive/realism-chain-feasibility-2026-09-09.md) · [hypit](../competitive/hypit-integration-viability-2026-09-17.md) · [muapi](../competitive/muapi-white-label-viability-2026-09-19.md) · [OGA reading list](../competitive/open-generative-ai-reading-list-2026-09-19.md) · [local-AI playbook](../competitive/local-ai-agency-playbook-viability-2026-09-19.md) · [state reassessment 09-17](state-reassessment-2026-09-17.md)

---

## 0. The headline

**Two things changed at once: the tree went quiet, and self-assessment was replaced by an outside auditor.**

The `ux/portal-overhaul` branch is merged; everything is on `main` with nothing pending anywhere. Commit velocity has fallen off a cliff — **43 commits on 09-17, 20 on 09-18, then 4, 3, 3**. For the first time in this stretch there is one worktree, no stash, no half-finished merge, and no peer holding a dirty file.

And on 21 Sep **a client auditor reviewed production from their own admin account, with real data, across eight journeys, and filed 23 findings — 6 of them High.** Twenty-two are closed in two commits. That is a different and better class of evidence than anything in the corpus above, all of which is self-produced.

**The audit led with money**, which is the strongest available validation of where the month went. It is also where it found the sharpest defect: the control that starts and stops a persona spending was unreachable from a keyboard.

**What has not moved is the cross-assessment queue.** Every item three or more independent assessments converged on is still at zero hits in the source. Nothing regressed; nothing advanced.

---

## 1. Gates — green

| Gate | Result |
|---|---|
| `vitest --project=unit` | **2,026 passed / 106 files** |
| `lint:ci` | **exit 0** — 0 errors, 1,134 warnings (ratchet 1,136, so 2 under) |
| Merge state | clean · 0 staged · 0 dirty · 0 stashes · 1 worktree |
| Position | `main`, level with `origin/main` |

The lint ratchet is two warnings from its ceiling — `c6e8cda` ("key the generator's each blocks to stay under the ceiling") was spent buying that headroom, so the next feature that adds three warnings fails the gate.

---

## 2. What landed since 09-19 — six commits

| Commit | What it is |
|---|---|
| `a4038da` | video: refuse an unfetchable media URL **before** spending a probe spawn and a temp dir |
| `836ad13` | portfolio: commit the enhancement benchmark **that actually enhanced** |
| `4ec6fd9` | portfolio: drop the benchmark run **whose chain never ran** |
| `c3bfbb5` | client QA — nine findings including three of six Highs |
| `8dd1706` | client QA — the rest; 22 of 23 closed |
| `c6e8cda` | lint: key the generator's `each` blocks to stay under the ceiling |

`836ad13` + `4ec6fd9` together are the week's discipline in miniature: the first benchmark run produced artefacts while the chain never actually ran, that run was deleted rather than reported, and only the run that enhanced was kept. That is the "a measurement that cannot fail is not evidence" rule applied to its own instrument.

### 2.1 The client audit, in the auditor's order

**Money first.** `UX-002`: the Studio now states **which wallet pays before you spend** — the user's own provider account when an OpenRouter key is saved, otherwise their wallet, with a note that a workspace persona bills the workspace owner. That rule previously existed only in an FAQ at the bottom of `/billing`. `QA-002`: one wallet, one number — `formatMoney` defaulted to `whole: true`, showing ₱3,131.00 in the sidebar against ₱3,131.25 on `/billing` for a balance of 3,131.247. `UX-004`: every disabled top-up tier now carries its own route forward instead of "Coming soon".

**The accessibility High is the one to remember.** `A11Y-001` — the Active toggle *is* the control that makes a persona generate and spend. It was a `<label>` wrapping `<input tabindex="-1">` with no id, no `aria-label`, no label text: **0 of 10 focusable, 0 of 10 named**. A keyboard or screen-reader user could not start or pause a persona at all. It is a `role="switch"` button now, 5 of 5 focusable and named, with `aria-checked` driving the visual so state and announcement cannot drift.

This is the exact class the [OGA reading list](../competitive/open-generative-ai-reading-list-2026-09-19.md) ranked P1 four days ago — *"one Svelte action closes a whole warning class"* — and the auditor found the live instance first. The reading list was right about the category and slow about the instance.

**Also closed:** one platform taxonomy (the dashboard hardcoded six platforms with different names than the persona page's thirteen), admin dates matching `/billing` in a workspace that bills in **PHP**, and a dashboard setup checklist driven by real account state which the auditor noted *"would have caught every blocker reported in testing before the user hit it."*

---

## 3. The cross-assessment queue — re-measured, and still at zero

Each of these was independently recommended by two or more assessments. Non-test hits across `src/`:

| Item | Sources | Hits | State |
|---|---|---|---|
| **Sandbox mode** — a full compose→quote→"generate" that spends nothing | Fannabe (evaluation gap), muapi (their `Free sandbox mode`), local-AI playbook (the demo motion) | **0** | Not started |
| **Word-anchored captions** — `timestamps: true` on the TTS call we already pay for | Hypit | **0** | Not started |
| **Enhancement stage A** (face restore) | Fannabe P0.1, realism-chain §2 | 3 — all comments saying it "lands later" | Deferred by design |
| **Enhancement stage B** (skin/detail) | Fannabe P0.1, realism-chain §3 | 1 — a comment | Deferred by design |
| **Recurring free credits** | Fannabe §6, muapi | 0 real | Free plan is still `included_credits: 0`, *"One free credit per person to start"* |
| **Charge outcome in failure copy** | OGA P1 | 0 | `failure-text.ts` exports `rawMessage`, `classifyFailure`, `customerFailureText` — none states whether the run was billed |
| **fal in `provider-balance.ts`** | fal-MCP finding | 0 | Monitors `'openrouter'` only (lines 36, 143) |

Two of those greps looked positive and were **noise on inspection** — "recurring credit" matched a changelog row and an autopilot comment (*"nothing this run does will refill it"*), and "refunded/not charged" matched unrelated strings. Reporting the raw counts would have been a false positive in both cases.

### 3.1 Enhancement chain — the model changed, the switch did not

`DEFAULT_UPSCALE_MODEL` is now **`fal-ai/seedvr/upscale/image`**, with the comment recording *"a live-measured $0.001/MP"*. That is the feasibility document's own recommendation adopted — it had said of the previous default, `esrgan`, *"Refuse to wire… compute-second has no measurable ceiling. This is why seedvr beats esrgan."* The earlier assessment noted esrgan shipped first and that the repo's own measurement went unread until after; that is now corrected in the code.

The chain remains **inert**: `enhance_chain` defaults off and `UGC_UPSCALE_USD` is unset, and the module logs *"enhance_chain is on but UGC_UPSCALE_USD is unset or invalid — the upscale pass…"* rather than running unpriced.

---

## 4. The one decision that is fully prepared and untaken

`portfolio/enhance-benchmark/2026-09-18T15-40-58-917Z/` contains six images — `front-cam`, `mirror`, `propped`, each A and B — plus `ANSWER-KEY.json` and a README that states the rule:

> *"For each register, look at `<register>-A.png` and `<register>-B.png` and decide which reads as a REAL photo of a REAL person: skin texture, pores, natural shadows — not sharpness. Score: A / B / no difference. Write it down BEFORE opening ANSWER-KEY.json. If 'upscaled' does not win clearly across registers, the pass is not earning its money and the first stage should be a skin/detail pass, not super-resolution."*

**There is no scoring artefact in that directory.** The harness was built, it ran, it produced the pairs — and nobody has judged them. Fannabe's P0.2 was *"Prove it or don't ship it… Judge blind."* Everything needed to make that call is on disk and takes about a minute; the call has not been made. This is the "built and unrun" note in memory advancing exactly one step, to "run and unscored".

**Two caveats on the instrument itself:**

- **I am no longer a valid judge of it.** While locating the artefact I printed `ANSWER-KEY.json` and have seen which side is upscaled in all three registers. A blind score has to come from you or from a session that has not read this file.
- **It benchmarks a model we do not ship.** The key records `"model": "fal-ai/flux-pro/v1.1"`, while production stills come from `nano-banana-2`. Even a clean blind score measures the pass over the wrong base image. Worth one re-run on the production model before the result is treated as decisive.

---

## 5. Open, and each needs a decision rather than work

1. **Score the benchmark** (§4). Gates whether stage C ships or stage B comes first — the README says so in its own words.
2. **The two audit findings left open**, both flagged as needing *"a product decision about what should be visible, not a UI change"*: the Hermes persona (a system record surfacing in a customer list) and the dashboard's generation counter reading 0.
3. **fal key scoping** — one admin-scoped key with `billing:usage:read` would make the platform connector's `get_usage` work (it 403s today), separate analytics from generation spend, and let the current key be rotated after being pasted into chat.

### 5.1 A tension worth resolving before it is "fixed"

The auditor flagged **the dashboard's generation counter reading 0**. The corpus records, from a live production read during the 09-08 pass, **zero generation events platform-wide since 2026-09-01**.

If that is still true, the counter is not broken — it is correct, and the finding is an adoption fact wearing a UI costume. Fixing the widget would then destroy the only place the business signal was visible. **This cannot be settled from this machine** (it needs a production query), and it should be settled before anyone changes that number's source.

---

## 6. Verdict

The product is in its best measured state of the fortnight: level with the mainline, gates green, 2,026 tests passing, nothing half-merged, and an outside auditor's list 22/23 closed — with the money cluster he led with now answered in the UI rather than in an FAQ.

The strategic queue is unchanged and now unusually cheap to move, because the tree is finally quiet. Sandbox mode is the only item three separate assessments converged on independently, it is a day's work on rails that exist, and it is the last piece of the "first ninety seconds" the Fannabe teardown identified as the whole competitive gap. Word-anchored captions remain one unsent boolean on a call already paid for.

The thing standing between the realism work and a decision is not engineering. It is a minute of looking at six PNGs.
