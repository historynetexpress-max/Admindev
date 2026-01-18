/**
 * server.js
 * Express backend that proxies to multiple AI providers.
 * - POST /api/chat  -> streams text chunks back to client (chunked transfer)
 * - POST /api/chat-sync -> non-streaming JSON response (full text)
 *
 * Environment variables (see .env.example):
 *  - OPENAI_API_KEY
 *  - OPENAI_MODEL
 *  - GOOGLE_API_KEY
 *  - GOOGLE_MODEL
 *
 * Note: This code forwards OpenAI streaming events and extracts text deltas,
 * then writes only the text chunk to client (as plain chunked text). Frontend
 * reads chunks and appends to UI.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Buffer } from 'buffer';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow non-browser tools
    if (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS origin not allowed'));
  }
}));

// Basic route
app.get('/', (req, res) => {
  res.send('Multi-AI Chat proxy running. Use /api/chat POST to interact.');
});

/**
 * POST /api/chat
 * Body: { model: string, prompt: string, temperature?: number }
 * Responds with chunked plain/text body — streaming textual chunks as they arrive.
 */
app.post('/api/chat', async (req, res) => {
  const { model, prompt, temperature } = req.body ?? {};
  if (!model || !prompt) {
    return res.status(400).json({ error: 'model and prompt are required' });
  }

  try {
    if (model === 'chatgpt') {
      // Stream from OpenAI and forward text deltas
      await streamOpenAICompletion(prompt, { temperature }, res);
      return;
    }

    if (model === 'googleai') {
      // Google Generative API (non-streaming). We'll send as single chunk.
      const out = await callGoogleGenerate(prompt, { temperature });
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.write(out);
      res.end();
      return;
    }

    // Placeholder for other providers — do a simulated response or return 501
    // For demo, provide a simulated reply
    const simulated = `Simulated reply for model "${model}":\n\n${prompt.split('').reverse().join('').slice(0, 800)}`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.write(simulated);
    res.end();
    return;

  } catch (err) {
    console.error('Error in /api/chat:', err);
    if (!res.headersSent) res.status(500).json({ error: String(err) });
    else res.end();
  }
});

/**
 * POST /api/chat-sync
 * Returns JSON with full text (no streaming) — useful for quick integrations.
 * Body: { model, prompt }
 */
app.post('/api/chat-sync', async (req, res) => {
  const { model, prompt } = req.body ?? {};
  if (!model || !prompt) return res.status(400).json({ error: 'model and prompt required' });

  try {
    if (model === 'chatgpt') {
      const text = await callOpenAICompletionFull(prompt);
      return res.json({ text });
    }
    if (model === 'googleai') {
      const text = await callGoogleGenerate(prompt);
      return res.json({ text });
    }
    // others: simulated
    return res.json({ text: `Simulated full response for ${model}: ${prompt.split('').reverse().join('').slice(0, 800)}` });
  } catch (err) {
    console.error('Error /api/chat-sync', err);
    return res.status(500).json({ error: String(err) });
  }
});

/* -------------------------
   Provider adapter functions
   ------------------------- */

/**
 * Stream OpenAI Chat Completion (stream: true) and forward textual deltas
 * to the client as plain chunks.
 */
async function streamOpenAICompletion(prompt, opts = {}, res) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!OPENAI_API_KEY) {
    res.status(500).write('Missing OPENAI_API_KEY on server');
    res.end();
    return;
  }

  // Build request
  const url = 'https://api.openai.com/v1/chat/completions';
  const body = {
    model: OPENAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: opts.temperature ?? 0.2,
    stream: true,
    max_tokens: 800
  };

  const providerResp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!providerResp.ok || !providerResp.body) {
    const errText = await providerResp.text().catch(()=>'<no body>');
    res.status(providerResp.status).setHeader('Content-Type','text/plain').end(`OpenAI error:\n${errText}`);
    return;
  }

  // Prepare client response for chunked text
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Read provider stream, parse SSE "data: ..." events and extract text deltas
  const reader = providerResp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // OpenAI sends events separated by double-newline. Split by \n\n
      const parts = buf.split(/\n\n/);
      // leave last partial in buffer
      buf = parts.pop() ?? '';

      for (const part of parts) {
        // each part may have lines; consider only lines beginning with "data: "
        const lines = part.split(/\r?\n/);
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.replace(/^data:\s*/, '');
          if (payload === '[DONE]') {
            // provider signals done
            // optionally write marker
            // res.write('[DONE]');
            res.end();
            return;
          }
          try {
            const parsed = JSON.parse(payload);
            // Support both delta streaming and final message content
            const delta = parsed.choices?.[0]?.delta;
            const text = delta?.content ?? parsed.choices?.[0]?.message?.content;
            if (text) {
              res.write(text);
            }
          } catch (err) {
            // ignore JSON parse errors
            // optionally forward raw payload
            // res.write(payload);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error while streaming OpenAI response:', err);
  } finally {
    // Ensure response ended
    try { res.end(); } catch (e) {}
  }
}

/**
 * Simple non-streaming call to OpenAI to get full text body
 */
async function callOpenAICompletionFull(prompt) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');

  const url = 'https://api.openai.com/v1/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.2
    })
  });

  if (!resp.ok) {
    const text = await resp.text().catch(()=>'<no body>');
    throw new Error(`OpenAI error ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  const content = json.choices?.[0]?.message?.content ?? '';
  return content;
}

/**
 * Call Google Generative API (simple non-streaming example using API key)
 * Requires GOOGLE_API_KEY environment variable.
 */
async function callGoogleGenerate(prompt, opts = {}) {
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  const GOOGLE_MODEL = process.env.GOOGLE_MODEL || 'models/text-bison-001';

  if (!GOOGLE_API_KEY) throw new Error('Missing GOOGLE_API_KEY');

  const url = `https://generativelanguage.googleapis.com/v1beta2/${GOOGLE_MODEL}:generateText?key=${encodeURIComponent(GOOGLE_API_KEY)}`;
  const body = {
    prompt: { text: prompt },
    temperature: opts.temperature ?? 0.2,
    candidateCount: 1,
    maxOutputTokens: 800
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const t = await resp.text().catch(()=>'<no body>');
    throw new Error(`Google API error ${resp.status}: ${t}`);
  }

  const json = await resp.json();
  const result = json?.candidates?.[0]?.content ?? '';
  return result;
}

/* Start server */
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});