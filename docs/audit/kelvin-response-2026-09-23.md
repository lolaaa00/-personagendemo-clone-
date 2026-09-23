# Response to Kelvin's QA audit — 23 September 2026

**Audience:** Kelvin (client). Plain language, for reading in one sitting.
**Companion page:** the same letter, formatted, is published as a private artifact (link in the chat where this was produced).

## Where things stand

- **26 of 28** findings fixed and confirmed by independent re-checks; the other 2 are answered below, not changed.
- **8** rounds of re-audit, each by three separate QA reviewers who wrote no code.
- **4** small leftovers still open — listed below, none a blocker.

## How we checked our own work

- After each batch of fixes, three separate reviewers went through the app with fresh eyes. Their job was to prove us wrong: they tried to reopen every one of your findings.
- They tested in Chrome, Firefox and Safari, on phone sizes (320 to 414 pixels wide), tablets and laptops, and as every kind of user: owner, admin, manager, creator, viewer and a brand-new account.
- They found things we had missed, so we fixed those too and ran the whole check again. Eight rounds in total.
- In the last three rounds, all three reviewers reported the same thing: none of your findings could be reopened.

## Money and numbers — fixed

- Text posts are never called "Free". Every post shows its real price before you click. (UX-001)
- Wherever a price appears, it says which wallet pays — yours, or the workspace owner's — and the balance pill names the workspace. (UX-002, ENH-006)
- The dashboard, the admin page and each persona page show the same counts, and they match the database. Rows for a persona with no handle no longer start with a stray "·". (QA-001, UI-001)
- Dates and times follow your language and your time zone, everywhere. (UI-005)
- When the review queue hides a post, it tells you which filter is hiding it and how to show it. (UX-010)
- Every generation shows its price, and who pays, before you approve it. (ENH-003)
- Dashboard numbers say what they count, and why a number is zero. (ENH-005)
- Your balance reads the same, to the cent, in the sidebar and on the Billing page. (QA-002)
- Extra, found by the reviewers: nine currencies (like AED and NGN) were being priced as if they were dollars. Fixed.
- Extra: asking for a top-up now actually loads the credit when we approve it, and Billing tells you it arrived.

## Accessibility and small screens — fixed

- The Active switch works with a keyboard and a screen reader, and says what it is. (A11Y-001)
- The persona list is a real table that screen readers can read row by row. (A11Y-002)
- On laptop screens, every menu item stays in view; nothing is pushed off the bottom. (UX-006)
- Settings tabs, the account menu, the setup steps and the tablet layout all behave properly. (UI-002, UX-009, UI-004, RESP-001)
- The button that collapses the sidebar is visible when you reach it by keyboard. (N1)
- Extra: text and buttons that were too faint now meet the contrast standard (WCAG AA), in light and dark mode.
- The persona page and the dashboard use one platform list with one set of names (no more "Twitter/X" on one page and "X" on another). (UI-003)
- Extra: every page fits a 320-pixel phone without sideways scrolling.

## Getting set up — fixed

- The Zernio key is explained clearly: it is your own account (free, with 2 connections), with a link to the guide that shows how to get it. Team members see wording that fits their role. (UX-005)
- The photo banner has a working Retry button. (UX-007)
- New personas default to the "Global" market, and the field sits above the Generate button. (UX-008)
- Login tells you exactly what is missing, and puts your cursor in the right box. (UX-011)
- "Forgot your password?" is right on the login page. (UX-012)
- When something fails, the message links straight to the guide for that problem. (ENH-001)
- The dashboard has a setup checklist that reflects your real progress and can be hidden. (ENH-002)
- Pages open at the top, and the Back button returns you to where you were. (M1)
- Retry keeps the platforms and settings of the post it retries, and viewers are told when they cannot retry. (M2, M3)
- If a password-reset email cannot be sent, the page says so honestly and offers "Ask us to help you sign in". (M4)
- Buttons that need a key we do not have are disabled and say why, and the key list no longer counts a provider that is not wired up. (UX-003)
- Extra: team members with a viewing-only seat no longer see buttons that would fail — they see the reason instead.

**Two things we caught before they reached anyone.** While re-checking, the reviewers found that one of our own fixes could have sent a post to Instagram twice, and that another opened the wrong Settings panel. Both were fixed the same day. This is exactly why we re-check with outside eyes.

## Answered, not changed — 2 items

- **Adding credit** (UX-004). Card payments are still switched off — a business decision. There is now an in-product way: press "Ask us to load" on the Billing page, we approve it, and the credit lands in your wallet with a note on Billing saying it arrived.
- **Five review-queue views** (ENH-004). You suggested checking usage before keeping all five. We kept them for now and will look at usage data before adding more; each view was included in the accessibility checks.

## Still open — 4 small items

- On the smallest iPhone size in Safari, pressing Back from the persona wizard can land at the top of the dashboard instead of where you were. Chrome and Firefox are fine.
- On tablets, long post titles in calendar chips are cut off instead of shortened with "…".
- The coloured circles that show a persona's initials are lower-contrast than we would like.
- A guide illustration overlaps its own labels at one laptop size. Cosmetic only.

By design, plan prices and top-up packs stay in US dollars; everything else shows in your currency.

## What we need from you

- **Your Zernio key.** Sign in at zernio.com with Google, copy the API key, and paste it into Settings → Provider API Keys. The free account includes 2 connections. Publishing runs through it.
- **Reset emails.** The mail service on the server is not set up yet, so password-reset emails do not go out. Until it is, the app says so and offers the "Ask us to help you sign in" button, which reaches us directly. We will confirm when mail is on.

## When you will see it

All of these fixes are finished and tested in our code base. They go live with the next release; we will confirm the date with you.

Questions on any item? Reply with its ID (for example UX-005) and we will show you exactly what changed and where.
