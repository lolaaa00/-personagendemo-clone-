# Cover note to Kelvin — 27 September 2026

**Audience:** Kelvin (client). To be sent as the email body, with `PersonaGen - Response to QA Audit - Kelvin - 2026-09-27.pdf` attached.

---

Subject: Your PersonaGen audit — every finding answered (PDF attached)

Hi Kelvin,

Thank you for the audit. It was thorough, fair, and it found real problems. This note is the short version; the attached PDF answers every numbered item in your order and walks your own regression checklist line by line.

**What we did with it**

- All 28 numbered items are answered: 26 fixed, 2 answered by design (UX-004 adding credit, ENH-004 the five review views), and the PDF says why for those two.
- We did not mark our own homework. After each batch of fixes, three separate reviewers tried to reopen every finding — in Chrome, Firefox and Safari, on phone, tablet and laptop sizes, and as every kind of user. Nine rounds. In every round since the sixth, none of your findings could be reopened.
- Your regression checklist is ticked, all 34 lines, on real browsers, with the evidence beside each line.
- Your checklist caught a real bug we had not seen: saving a provider key had been failing since 17 September. Fixed, re-checked, and credited to you in the PDF.
- One rule changed underneath several findings: your own provider keys are no longer used for generation. The wallet always pays, every price says which wallet, and the only key you bring is your Zernio key. The failure you hit during testing cannot happen again.

**Switching publishing on**

Nothing is needed from you to use the product. When you want to publish, the Docs page "Get publishing working (the Zernio key)" walks you through adding your Zernio key in about two minutes; the Settings row and the dashboard checklist both link straight to it.

**Release**

Everything in the PDF is live at honeyx.monarchstack.com now — the audit fixes since 25 September, and password-reset emails (sent from noreply@l2gseo.com, verified end to end) since 27 September. Nothing is pending on our side.

If anything in the PDF does not match what you see, reply with the item's ID (for example UX-005) and we will show you exactly what changed and where.

Best regards,
The PersonaGen team
