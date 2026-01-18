# Multiple AI Chat — Fullstack Demo (Frontend + Node/Express proxy)

यह प्रोजेक्ट एक local demo है जो:
- फ्रंटएंड: मल्टी AI मॉडल्स चुनने वाला UI (horizontal top bar, floating model cards, chat composer)
- बैकएंड: Node/Express proxy endpoints जो real AI providers (OpenAI streaming, Google Generative API) से request forward करते हैं

Important:
- Never put API keys in frontend. Use .env (server).
- This repo requires Node 18+.

Quick start:
1. Copy files into a folder.
2. Create `.env` from `.env.example` and fill keys.
3. Install:
   npm install
4. Start server:
   npm run dev   # (or `npm start` for production)
5. Open http://localhost:3000 (or the port you set)

Supported providers in this demo:
- chatgpt -> OpenAI (streaming)
- googleai -> Google Generative API (non-streaming)
- other model ids map to simulated responses/placeholders (extend adapters in `server.js`)

How streaming works:
- Frontend POSTs to `/api/chat` with { model, prompt }.
- Server forwards to provider; streams incremental text chunks to client as they arrive.
- Client appends chunks to message element so the chat appears streaming.

Security & production notes:
- Use rate-limiting, authentication, request quota checks in production.
- Add logging, telemetry, and robust error handling before exposing to public.

If you want, मैं `copilot/grok/perplexity` के असली API adapters भी जोड़ दूँगा (जहाँ वे public APIs से उपलब्ध हों) — बताइए कौन-कौन से providers आपके पास API credentials में हैं।