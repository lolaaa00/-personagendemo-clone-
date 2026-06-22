# Implementation Plan - UI & Logic Fixes for User Testing Feedback

This plan covers fixes and enhancements to resolve issues identified during user testing, focusing on chat markdown rendering, manual product entry in Brand Brief, fallback persona creation in the Generator, calendar draft status support, and decoder metadata labeling.

## User Review Required

> [!IMPORTANT]
> - **Local Agent Creation Fallback:** When the external Puppeteer/Playwright Account Factory (`services/factory`) is offline or fails, we will auto-create the agent record and default configurations directly in Supabase. The frontend will show a success toast indicating the persona was saved locally, allowing uninterrupted testing.
> - **Product Creation Interface:** We are introducing a manual product creation card directly within the Brand Brief products view since the scraper can fail on rate-limited store pages.

## Proposed Changes

---

### 1. Svelte Chat Pages Markdown Rendering & Layout Fixes

We will replace the simplistic line-by-line replacement with a robust helper function `renderMarkdown()` in both chat interfaces to support headers, lists, italics, bold text, inline code, and paragraphs. We will also update CSS to prevent overflow.

#### [MODIFY] [AgentChat.svelte](file:///c:/Users/nexal/personagendemo/personagen-svelte/src/lib/components/agents/AgentChat.svelte)
* Add `escapeHtml` and a recursive `renderMarkdown` function in the script block.
* Replace direct string bindings with Svelte's `{@html renderMarkdown(msg.content)}`.
* Add `word-break: break-word;` and `overflow-wrap: break-word;` to `.chat-bubble`.
* Ensure `<pre>` tool log containers have horizontal scrolling and don't expand the bubble.

#### [MODIFY] [chat/+page.svelte](file:///c:/Users/nexal/personagendemo/personagen-svelte/src/routes/(portal)/chat/[[agentId]]/+page.svelte)
* Replace the paragraph split rendering with the `renderMarkdown` helper.
* Ensure word-break and overflow-wrap properties are set on `.message-bubble` to prevent horizontal overflow and clipping on the right.

---

### 2. Brand Brief Product Entry & Tone Editor

#### [MODIFY] [brand-brief/+page.svelte](file:///c:/Users/nexal/personagendemo/personagen-svelte/src/routes/(portal)/brand-brief/+page.svelte)
* Implement a manual product addition card in the products tab.
* Provide an input form for: Name, Price, Description, and Image URL.
* Add an `addProduct` function to append the product to the local state and database JSON structure.
* Make sure custom sample posts are correctly loaded and saved to the database.

---

### 3. Agent Generator Local Creation Fallback

#### [MODIFY] [+server.ts (Engine API)](file:///c:/Users/nexal/personagendemo/personagen-svelte/src/routes/api/engine/+server.ts)
* Wrap the `factory.createAccount` call inside a `try/catch` block.
* On error, perform direct insertion into the Supabase `agents` and `agent_configs` tables.
* Return a success payload indicating local creation succeeded.

---

### 4. Content Calendar Draft & Filter Improvements

#### [MODIFY] [calendar/+page.server.ts](file:///c:/Users/nexal/personagendemo/personagen-svelte/src/routes/(portal)/calendar/+page.server.ts)
* Preserve the `'draft'` status in the posts mapping so that drafts are not converted into `'scheduled'`.

#### [MODIFY] [calendar/+page.svelte](file:///c:/Users/nexal/personagendemo/personagen-svelte/src/routes/(portal)/calendar/+page.svelte)
* Add a "Filter Status" dropdown next to "Filter Agent".
* Implement a "Save as Draft" button in the post composer modal footer.
* Update state arrays and toast popups to support saving drafts.
* Add a different visual theme/color for draft posts inside calendar cells and list views.

---

### 5. Channel Decoder AI Inference Warning Banner

#### [MODIFY] [channel-decoder/+page.svelte](file:///c:/Users/nexal/personagendemo/personagen-svelte/src/routes/(portal)/channel-decoder/+page.svelte)
* Render a glass-card alert box at the top of the Results step, highlighting that unauthenticated scrapes fall back to public AI strategic inference.

---

## Verification Plan

### Automated Tests
* Run `npm run test` or check Svelte build to ensure no TypeScript or compilation warnings/errors are introduced:
  ```bash
  cd personagen-svelte
  npm run check
  ```

### Manual Verification
* Navigate to the **Generator** page and trigger agent creation; verify it redirects successfully to Persona Config and displays the new agent even when the factory is offline.
* Open **Brand Brief**, select Products, and manually add a new product. Verify it shows up in the grid and remains saved after page refresh.
* Open **Content Calendar**, click a day, open the composer, write a test message, and click "Save as Draft". Confirm the draft displays on the calendar with a warning/yellow theme.
* Validate that **Agent Chat** render headers (`####`) and lists correctly, and bubbles wrap text cleanly without cut-off.
