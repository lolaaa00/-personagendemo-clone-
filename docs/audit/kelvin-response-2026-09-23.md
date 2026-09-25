# Response to Kelvin's QA audit — 23 September 2026 (draft; superseded)

> **Superseded on 25 September 2026** by `PersonaGen - Response to QA Audit - Kelvin - 2026-09-25.pdf` in this folder (built from the published artifact). That version has all 34 checklist lines ticked, no "still open" items, nothing asked of the client, and records the key-save bug the checklist caught.

**Audience:** Kelvin (client). Plain language, for reading in one sitting.
**Covers:** the audit dated 21 September 2026 (28 numbered items; 34-line regression checklist).
**Companion page:** the same letter, formatted, is published as a private artifact (link in the chat where this was produced).

## Where things stand

- **26 of 28** numbered findings fixed and re-checked; the other 2 are answered, not changed (UX-004, ENH-004).
- **32 of 34** lines of your own regression checklist ticked on real browsers; 2 need a write action and are ticked last (marked below).
- **9** rounds of re-audit, each by three separate QA reviewers who wrote no code.

Kelvin — thank you for the audit. Below is every item you numbered, in the order you gave it, with what we changed and how we checked it. Then your regression checklist, line by line. Then the small things still open.

## How we checked our own work

- After each batch of fixes, three separate reviewers went through the app with fresh eyes. Their job was to prove us wrong: they tried to reopen every one of your findings.
- They tested in Chrome, Firefox and Safari; on phone widths (320 to 414 pixels), tablets (768 and 1024) and laptops (1280 to 1605); and as every kind of user — owner, admin, manager, creator, viewer and a brand-new account. You could only test as Admin in Chrome at 1605 pixels; we covered the rest.
- They found things we had missed, so we fixed those too and ran the whole check again. Nine rounds in total.
- In every round since the sixth, all three reviewers reported the same thing: none of your findings could be reopened.

> **One rule changed underneath several findings.** The failure you hit — a generation failing on your own OpenRouter balance while the sidebar showed a healthy wallet — cannot happen any more. Your own provider keys are no longer used for generation at all. The wallet always pays, and every price says which wallet. The only key you bring is Zernio, because it is your publishing identity, not a cost. Two small exceptions charge the person clicking, not the workspace: the Brand Brief's text helpers and the persona wizard's drafts, a few cents each — and each of those buttons now says so.

## Your findings, one by one

### High

| ID | What you found | What we did | Status |
|---|---|---|---|
| UX-001 | Ten text formats labelled "Free" although every format spends writing credit. | No format says "Free". Every text format shows its real writing cost — a Quote Card is $0.08, the same figure the Billing page quotes. *Checked: 41 Studio tiles, zero "Free" labels; Studio $0.08 = Billing $0.08.* | Fixed |
| UX-002 | Nothing says which wallet pays; the sidebar pill may show the wrong wallet. | The Studio header says "Generating here draws on your wallet". The generate dialog's footer says "Est. charge $0.08 from your wallet" — or "from the [workspace] wallet" for a team member. The sidebar pill is labelled with the wallet it shows (the workspace name, or "Your wallet"). And, per the rule above, your own keys are never charged. The Brand Brief's Generate / Spin / AI Enrich buttons and the wizard's Suggest directions / Generate options now show their price and "charged to your own wallet" too. | Fixed |
| UX-003 | Scrape & Populate is enabled with no Firecrawl key; Kie AI counts toward "0/2 set" while not wired up. | Scrape & Populate is disabled with a reason when Firecrawl is not available ("Research is unavailable on this deployment right now"). The key list no longer asks for keys we do not need: Zernio is the only key you bring, providers that run on our keys are listed as "Included", and a provider that is not wired up is not counted. *Checked: button disabled with title; counters read "Publishing 0/1 set · Included 4 · No key to bring 2".* | Fixed |
| UX-004 | No in-product way to add credit; all four tiers "Coming soon". | Card payments are still switched off — a business decision, as you noted. What we did instead is what you recommended: each tier now has its own "Ask us to load $10 / $25 / $50 / $100" button. The request reaches us directly; when we approve it, the credit lands in your wallet and Billing shows a line saying it arrived. | Answered |
| UX-005 | Zernio setup is a dead end; no screen links to the guide; nobody says who provides the first key. | The Zernio row now says plainly: "Zernio bills your own Zernio account per connected account (2 free)", with a "Where do I get a Zernio key?" link to the guide. Sign in at zernio.com with Google, copy the key, paste it in. The dashboard checklist's "Add key" step opens that exact row. If a persona has no key yet, its Connections tab says so and links to both the row and the guide. | Fixed |
| A11Y-001 | The persona Active toggle cannot be reached by keyboard and has no name. | Each toggle is a real switch: Tab reaches it, it is named ("Active: Theo Marsh"), and it announces on/off. *Checked: 5 of 5 toggles reached by Tab in Chrome, Firefox and Safari, each with a name and a state.* | Fixed |

### Medium

| ID | What you found | What we did | Status |
|---|---|---|---|
| QA-001 | Published, persona and generation counts disagree between Dashboard, Admin and the persona page. | Each metric now comes from one source and every card names its period ("published in the last 7 days", "switched on to generate · 3 of 6 connected"). The reviewers checked the three pages against the database in every round since round 6. | Fixed |
| UI-001 | A persona with no handle shows a stray "·" at the start of its row. | The separator only appears between two values. One empty-value convention across the product. | Fixed |
| UX-006 | The persona list pushes Review Queue, Calendar, Docs, Billing and Settings out of view. | The primary destinations sit above the persona list, so they never move. *Checked at 1280×720, 1366×768 and 1605×973: Settings and Docs visible with no sidebar scrolling.* | Fixed |
| UX-007 | The reference-photo failure banner tells you to retry but has no retry. | The banner has a Retry button. | Fixed |
| UX-008 | Market defaults to Australia. | Market defaults to Global, and the field sits above the Generate button. | Fixed |
| UI-002 | The Settings section switcher has no tab semantics or selected state. | It is a proper tab list: 8 tabs, one selected, announced as such. *Checked in Chrome, Firefox and Safari.* | Fixed |
| UI-003 | The persona page lists 13 platforms, the dashboard 6, with different names ("X" vs "Twitter/X"). | Both pages read from one platform list with one set of names. | Fixed |
| UX-009 | Escape does not close the user menu. | Escape closes it and puts focus back on the button. *Checked in Chrome, Firefox and Safari.* | Fixed |
| UX-010 | The Review Queue says "65 of 66 shown" without saying what is hidden or why. | The count names the filter that is hiding items, and the hidden items are one click away. | Fixed |
| A11Y-002 | The persona list looks like a table but is not one; only one row was marked. | The list carries full table semantics: a table, a header row, and every row and cell marked, so a screen reader reads it row by row and knows which column each value belongs to. *Checked in Chrome, Firefox and Safari: every row has its cells.* | Fixed |
| RESP-001 | At exactly 768px the shell is in mobile mode but the page masthead is still in desktop mode. | The masthead now crosses at 768px with the shell. Today we also moved the Review Queue's own phone rules from 767 to 768, so nothing in the product keys on 767 any more. *Checked at 767, 768 and 769 in Chrome, Firefox and Safari: 767 and 768 identical, 769 desktop.* | Fixed |

### Low

| ID | What you found | What we did | Status |
|---|---|---|---|
| QA-002 | The pill shows ₱3,131.00 while Billing shows ₱3,131.25. | The balance is formatted once, on the server, to real cents; the pill and Billing show the identical amount. *Checked in three browsers and, by the reviewers, in yen, won, pounds and euros.* | Fixed |
| UI-004 | Wizard progress is visual only. | The current step is marked and read out as "Step 1 of 3". *Checked in three browsers.* | Fixed |
| UX-011 | Empty sign-in submit shows the failed-credentials message. | It now says: "Enter your email and password to sign in. Fill in both fields and try again." | Fixed |
| UX-012 | No password reset link. | "Forgot your password?" sits on the sign-in form. One caveat below, under "On our side". | Fixed |
| UI-005 | Admin shows US-style dates next to PHP currency. | Dates and times follow your language and your time zone on every page, Admin included. | Fixed |

### Enhancements you suggested

| ID | Your suggestion | What we did | Status |
|---|---|---|---|
| ENH-001 | Put the docs where the failure happens. | Error messages that have a matching guide link to it, and the provider row links to its guide. | Done |
| ENH-002 | A setup checklist on the dashboard. | The dashboard has a checklist driven by real state, and it can be hidden. | Done |
| ENH-003 | Show cost and funding source before the click. | The generate dialog's footer: "Est. charge $0.08 from your wallet". Every other paid button — identity kit, profile photo, Brand Brief helpers, wizard drafts — carries its price and payer the same way. | Done |
| ENH-004 | Reconsider five Review Queue views. | Kept for now, as you framed it — an observation, not a defect. We will look at usage before investing further. All five were included in the accessibility checks. | Answered |
| ENH-005 | Let the dashboard explain its own zeroes. | Each card says what it counts and for what period. | Done |
| ENH-006 | Name the workspace in the balance pill. | The pill reads "UX Audit Co $120.00" for a workspace, "Your wallet" for a solo account. | Done |

**Things we caught before they reached anyone.** While re-checking, the reviewers found that one of our own fixes could have sent a post to Instagram twice, and that another opened the wrong Settings panel. In the last round they found four more at the edges of our fixes: the Brand Brief and wizard buttons above were still unpriced, the Back button could jump the page after you had started scrolling, the week view's calendar chips clipped their keyboard focus ring, and one top-up pack showed two converted amounts. All fixed and re-checked with the reviewers' own tests. This is exactly why we re-check with outside eyes.

## Your regression checklist

You asked for these to be ticked on a real browser, not in a code review. They were: Chrome, Firefox and Safari, on 23 September, against the build that carries every fix. "3 browsers" means all three passed.

### Cost and funding

| Your line | Result | Evidence |
|---|---|---|
| No format in the Studio displays Free unless it genuinely costs nothing | ✓ | 41 Studio tiles, zero "Free" labels |
| Text format cost in the Studio matches the figure quoted on Billing | ✓ | Quote Card $0.08 in the Studio; "about $0.08" on Billing |
| Generate action names the funding source before the run starts | ✓ | Dialog footer "Est. charge $0.08 from your wallet"; Studio header names the wallet; Brand Brief and wizard buttons show their price and "charged to your own wallet" |
| Sidebar balance pill names which wallet it shows | ✓ | "UX Audit Co $120.00" for a workspace member; "Your wallet" for a solo account |
| Sidebar balance and Billing balance display the identical amount to two decimals | ✓ | $120.00 on both, 3 browsers |
| A user with a saved OpenRouter key sees that their own key will be charged | ✓ | Premise removed: no OpenRouter key is collected any more; the wallet always pays |

### Setup journeys

| Your line | Result | Evidence |
|---|---|---|
| Every provider row in Settings links to its guide | ✓ | The one row you bring a key for (Zernio) links to /guides#zernio-key |
| Zernio panel states where the first key comes from and who provisions it | ✓ | "Zernio bills your own Zernio account per connected account (2 free)" + "Where do I get a Zernio key?" |
| Scrape & Populate is disabled, with a reason, when Firecrawl is unset | ✓ | Disabled; title "Research is unavailable on this deployment right now" |
| Kie AI no longer counts toward the Media Generation setup counter while unimplemented | ✓ | No such counter remains; providers that run on our keys are listed as "Included" |
| Saving a provider key shows a success state and the status flips to Saved | ticked last | This one writes a key, so it runs after the read-only checks finish; result added below |

### Data consistency

| Your line | Result | Evidence |
|---|---|---|
| Published count is identical on Dashboard, Admin and the persona page | ✓ | Reviewers compared the three pages with the database, rounds 6–9 |
| Workspace published total is greater than or equal to any single persona total | ✓ | Same check |
| Persona count matches between Dashboard and Admin, or Hermes is intentionally excluded from both | ✓ | Same check |
| Dashboard generation counts are non-zero for personas with activity in the Admin log | ✓ | Same check |
| Spend uses one currency per surface, with the period labelled | ✓ | "3 Active Personas — switched on to generate · 3 of 6 connected"; "5 Posts This Week — published in the last 7 days" |

### Accessibility

| Your line | Result | Evidence |
|---|---|---|
| Tab reaches the Active toggle on every persona row | ✓ | 5 of 5, 3 browsers |
| Screen reader announces the Active toggle with the persona name and its state | ✓ | "Active: Theo Marsh", on/off announced, 3 browsers |
| Active toggle operates with Space or Enter | ticked last | This one changes a persona's state, so it runs after the read-only checks; result added below |
| Settings section switcher exposes tab roles and a selected state | ✓ | Tab list, 8 tabs, one selected, 3 browsers |
| Escape closes the user menu and returns focus to the trigger | ✓ | 3 browsers |
| Persona list announces column and row associations | ✓ | Table, header row, every row and cell marked, 3 browsers |
| Wizard announces step position | ✓ | "Step 1 of 3, current: 1 Identity", 3 browsers |

### Responsive

| Your line | Result | Evidence |
|---|---|---|
| At exactly 768px the masthead and the shell are both in mobile mode | ✓ | 767 and 768 identical, 769 desktop, 3 browsers |
| Persona list is usable at 390px with no horizontal page scroll | ✓ | 0 px overflow, 3 browsers |
| Persona list is usable at 768px | ✓ | 0 px overflow, 3 browsers |
| Sidebar nav reaches Settings and Docs without scrolling past 14 personas | ✓ | Primary destinations sit above the persona list; visible with no scrolling at 1280×720, 1366×768, 1605×973 |
| Dialogs and dropdowns stay inside the viewport at 375px | ✓ | User menu inside 375×667; reviewers checked dialogs and drawers at 320–414 in every round |

### Sign-in

| Your line | Result | Evidence |
|---|---|---|
| Empty submit shows empty-field copy, not failed-credentials copy | ✓ | "Enter your email and password to sign in. Fill in both fields and try again." — 3 browsers |
| Deep link to /dashboard returns to /dashboard after sign-in | ✓ | /billing while signed out → sign-in → back on /billing |
| Password reset is reachable from the sign-in form | ✓ | "Forgot your password?" → /reset-password, 3 browsers |
| Sign-in layout holds at 375px | ✓ | 0 px overflow, 3 browsers |

### Regression guards

| Your line | Result | Evidence |
|---|---|---|
| No new console errors on any audited route | ✓ | All 11 routes, as owner, as admin and signed out: zero console errors, zero failed requests, zero 4xx/5xx |
| A single dashboard load still makes one API call, not several | ✓ | One call (/api/analytics) |

## Still open — 4 small items

None of these is in your audit. The reviewers found them at the edges of our fixes, and we would rather you hear them from us.

- On tablets, long post titles in calendar chips are cut off instead of shortened with "…".
- The coloured circles that show a persona's initials are lower-contrast than we would like.
- A guide illustration overlaps its own labels at one laptop size. Cosmetic only.
- In countries whose money also uses the "$" sign (Mexico, Chile and others), a local price and a US-dollar price can sit side by side with the same sign. Your pesos show "₱", so this does not affect you.

By design, plan prices and top-up packs stay in US dollars; everything else shows in your currency.

## What we need from you

- **Your Zernio key.** Sign in at zernio.com with Google, copy the API key, and paste it into Settings → Provider API Keys. The free account includes 2 connections. Publishing runs through it.

## On our side

- **Reset emails.** The mail service on the server is not set up yet, so password-reset emails do not go out. Until it is, the reset page says so honestly and offers "Ask us to help you sign in", which reaches us directly. We will confirm when mail is on.
- **Release.** All of these fixes are finished and tested in our code base. They go live with the next release; we will confirm the date with you.

Questions on any item? Reply with its ID (for example UX-005) and we will show you exactly what changed and where.
