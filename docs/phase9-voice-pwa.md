# Phase 9 — Voice and PWA

Branch `team/phase9-voice-pwa`. Frontend: `frontend/`; backend: `backend/src/{routes/assistant.routes.js, services/{sarvam,groq,assistant}.service.js}`.

## What exists

| Area | Files | Notes |
|---|---|---|
| Speech-to-text | `components/VoiceInputButton.jsx`, `hooks/useVoiceRecorder.js`, backend `POST /api/assistant/transcribe` | Browser records (MediaRecorder); backend forwards to Sarvam; nothing stored. |
| Text-to-speech | `components/SpeakButton.jsx`, backend `POST /api/assistant/speak` | Sarvam `bulbul:v3`; audio cached in memory only. |
| Reusable entry point | `src/voice/index.js` | Both buttons accept `getToken` so any chat can reuse them. |
| PWA | `public/{manifest.webmanifest,sw.js,offline.html,icons/}`, `src/pwa/registerServiceWorker.js`, `components/PwaStatus.jsx`, hooks `useOnlineStatus`, `usePwaInstall` | Worker registers in production builds only. |
| Chat (temporary) | `pages/AskAiPage.jsx`, backend `POST /api/assistant/chat` (Groq, grounded in verified mandi prices) | **Overlaps Phase 7** — see below. |

## Safe caching rules (enforced by `test/sw-policy.test.js`)

- Only same-origin `GET` static shell files are cached (`/assets/`, `/icons/`, `/images/`, manifest, offline page) plus the HTML shell for navigations.
- Never cached: `/api/*`, any request with an `Authorization` header, all cross-origin traffic (Firebase token endpoints, Google, a backend on another origin), non-GET requests, non-2xx, redirected or opaque responses.
- Offline, the app shows a banner and `offline.html`; **no market price is ever served from a cache**, so a saved price cannot be shown as live.
- Host `sw.js` with `Cache-Control: no-cache` so updates are picked up.

## Phase 7 overlap and integration plan

State seen read-only in `D:\Projects\fasalytics-phase7` (branch `team/phase7-ai-copilot`): only a stub `backend/src/ai/index.js` ("Gemini, Grok, Sarvam AI") so far.

| Phase 9 piece | Phase 7 owns? | Plan after merge |
|---|---|---|
| `VoiceInputButton`, `SpeakButton`, `useVoiceRecorder`, `sarvam.service.js`, `/transcribe`, `/speak` | No — keep | Copilot imports from `src/voice`, passes its own `getToken`. |
| `groq.service.js`, `assistant.service.js`, `POST /api/assistant/chat`, `AskAiPage` chat UI | **Yes (final chatbot)** | Treat as a placeholder. When Phase 7's `/api/copilot/chat` lands, point `sendChatMessage` at it, then delete `/api/assistant/chat`, `assistant.service.js` and Groq config if Phase 7 supplies its own. Keep the grounding rules (verified, non-sample prices only; deterministic fallback). |
| `GET /api/assistant/capabilities` | Shared | Fold into `/api/copilot/capabilities`; keep `speechToText` / `textToSpeech` flags. |

## Merge-conflict risks

1. `frontend/src/pages/AskAiPage.jsx` — rewritten here; Phase 7 will rewrite it too. Highest risk: take Phase 7's page and re-add `<VoiceInputButton>` / `<SpeakButton>`.
2. `frontend/src/i18n/strings.js` — new keys inserted at the top of each language block (`voice.*`, `pwa.*`, `a11y.*`, `ai.*`); Phase 7 adds keys in the same places. Resolve by keeping both; run `npm run check:i18n`.
3. `backend/src/app.js` and `backend/src/config/index.js` — one route mount and the `sarvam`/`groq` config blocks.
4. `backend/src/pipeline/normalizer.js` — adds `detectCommodityCode` (Phase 7 may need the same; reuse it).
5. `backend/test/credential-handling.test.js`, `backend/scripts/test-env.js`, `backend/.env.example` — allowlist and blanked-key entries for `GROQ_API_KEY` / `SARVAM_API_KEY`.
6. `frontend/src/services/api.js` — `apiRequest` accepts a `Blob` body.
7. `frontend/src/layouts/MainLayout.jsx`, `index.html`, `src/main.jsx` — PWA status bar, skip link, manifest links, worker registration.

## Environment prerequisite

`backend/test/agmarknet-import.test.js › parseAgmarknetCsv` reads `backend/data/mandi/agmarknet/Market_Wise_Price_Arrival_09-10-2026_01-26-14_AM.csv`. `backend/data/` is gitignored, so a fresh worktree lacks the file and that one test fails. It passes (5/5) in the main worktree where the file exists. Copy the real report into the worktree to run it; the test was not changed.

## Known limitations

- Service worker activation was not verified in a real browser (the embedded browser pane rejects every worker registration); behaviour is covered by VM-based tests and the production build contents.
- Sarvam and Groq calls have not been made with real keys; request shapes follow the official SDK / OpenAI-compatible API and are covered by fake-HTTP tests. The default Groq model (`llama-3.3-70b-versatile`) is unverified until a key is set (`GROQ_CHAT_MODEL` overrides it).
- Sarvam STT accepts webm/mp4/ogg per its SDK types; Marathi voice quality is unverified.
- Offline mode shows the app shell only; there is no offline data.
