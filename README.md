# Tab2ChatGPT v2 (Seamless In-Page AI Relay)

This version removes the old popup-heavy workflow and replaces it with a floating in-page assistant.

## What is new

- Floating button on normal sites (`Ask AI`) for immediate access.
- Premium dock UI (Linear-inspired dark utility panel).
- One-step send using page text context and optional screenshot.
- Better large-page accuracy pipeline:
  - Mozilla Readability extraction for main content
  - Query-aware chunk ranking from extracted content
  - Prompt token budgeting to avoid noisy overlong context
- Multi-provider handoff:
  - ChatGPT
  - Gemini
  - Claude
- Default provider setting (defaults to ChatGPT).
- Keyboard shortcuts:
  - Toggle assistant: `Cmd/Ctrl + Shift + K`
  - Quick send to default provider: `Cmd/Ctrl + Shift + Y`

## Architecture

- `content-dock.js` is a thin entry that initializes dock modules.
- `content-dock-ui.js` manages dock state, UI, drag/resize, and chat actions.
- `content-dock-renderer.js` handles markdown/html rendering and sanitization.
- `content-dock-context.js` extracts and ranks page context.
- `background.js` manages settings, captures screenshot, builds prompt, opens provider tab.
- `provider-bridge.js` is a thin entry for bridge message routing.
- `provider-bridge-actions.js` handles prompt injection, submit flow, and image attach.
- `provider-bridge-stream.js` runs provider-agnostic streaming logic.
- `provider-bridge-scrape.js` scrapes latest provider output and generation state.
- `provider-bridge-config.js` + `provider-bridge-utils.js` hold provider config and shared helpers.
- `@mozilla/readability` powers main-content extraction before chunk ranking.

## Install (Developer Mode)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select: `/Users/satyamchaudhary/Desktop/chat-website`
5. Optional: open `chrome://extensions/shortcuts` to customize keys.

If you freshly clone this folder, run:

```bash
npm install
```

## Usage

1. Open any site.
2. Click `Ask AI` (or use `Cmd/Ctrl + Shift + K`).
3. Pick provider, set toggles (`Image`, `Full Ctx`, `GPT Instant/Thinking`), and enter your question.
4. Press `Go` to send.
5. Use the follow-up input for subsequent messages. By default, full page context is sent once per chat thread, then follow-ups send without full context.

The extension opens/focuses the provider, inserts prompt + image, and auto-sends if enabled.

## Notes

- Provider UI selectors can change, which may require selector updates in `provider-bridge.js`.
- Some pages block content scripts (`chrome://*`, Chrome Web Store, browser internal pages).
- Image upload behavior depends on provider login state and active UI experiment variants.
# AskFromTab
