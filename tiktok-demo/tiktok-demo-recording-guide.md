# TikTok API Review — Demo Video Recording Guide

**Purpose:** Record a 60–90 second Loom walkthrough of the PersonaGen TikTok integration for submission to TikTok's Content Posting API review.

**Demo File:** Open `index.html` in a browser before recording.

---

## Recording Steps

### 1. Channels Overview *(~10 seconds)*

- Start on the **Channels** page (default view)
- Briefly show the dashboard with existing connected accounts
- Click the **TikTok** card to begin the connection flow

### 2. OAuth Authorization *(~15 seconds)*

- The authorization modal will appear
- Point out the **three scopes** being requested:
  - `video.upload`
  - `video.publish`
  - `user.info.basic`
- Click **"Authorize PersonaGen"**
- Wait for the loading spinner to complete → success toast appears

### 3. Create a Post *(~25 seconds)*

- Click **Create Post** in the left sidebar
- The connected profile bar shows the TikTok username and avatar
- **Upload a video:** Click the upload zone (simulates automatically)
- **Edit the caption:** Modify the pre-filled text to show it's editable
- **Add a hashtag:** Type a new tag in the hashtag field and press Enter
- **Change privacy:** Select a different option from the dropdown (e.g., "Friends")
- **Toggle a disclosure:** Turn on "Branded Content" to demonstrate compliance controls

### 4. Publish with Confirmation *(~15 seconds)*

- Click **"🚀 Publish to TikTok"**
- A confirmation modal appears showing:
  - Caption preview
  - Hashtags
  - Privacy setting
- Click **"✓ Confirm & Publish"**
- Wait for the success toast

### 5. Disconnect Account *(~10 seconds)*

- Click **Settings** in the left sidebar
- Show the **TikTok Account** section with disconnect option
- Point out the explanation of what happens when disconnecting (token revocation, data removal)
- Click **"🔌 Disconnect TikTok"** → Confirm in the modal

---

## Key Points to Mention During Recording

| Requirement | Where It's Shown |
|---|---|
| User can edit caption before posting | Create Post → Caption field |
| User can edit hashtags before posting | Create Post → Hashtags field |
| Manual confirmation before publish | Publish confirmation modal |
| No auto-posting without user action | Confirm & Publish button |
| User can disconnect at any time | Settings → Disconnect TikTok |
| Only necessary scopes requested | OAuth modal → 3 scopes listed |
| Privacy controls available | Create Post → Privacy dropdown |
| Branded content disclosure | Create Post → Content Disclosures |

---

## Tips

- **Speak naturally** — don't read a script word-for-word
- **Move slowly** — let each screen be visible for at least 2–3 seconds
- **Use Loom's cursor highlight** so reviewers can follow your clicks
- **Keep it under 90 seconds** — concise submissions get reviewed faster

---

*PersonaGen — JamesDev Pro*
