// Cloudflare Worker proxy for the Groq API.
// Hardened: this is a PUBLIC endpoint backed by a funded Groq key, so it never
// forwards the client body verbatim. It validates the request and rebuilds a
// sanitized payload — clients cannot pick an arbitrary model, blow up
// max_tokens, or smuggle oversized prompts to run up the bill.

const MODEL_ALLOWLIST = new Set([
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
]);
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

const MAX_OUTPUT_TOKENS = 1024;   // hard ceiling on completion length
const DEFAULT_OUTPUT_TOKENS = 600;
const MAX_MESSAGES = 24;          // system + a few exchanges of history
const MAX_TOTAL_CHARS = 32000;    // ~8k tokens of input across all messages
const VALID_ROLES = new Set(['system', 'user', 'assistant']);

function jsonError(message, status, corsHeaders) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = new Set([
      'https://crypto-counsel.systemslibrarian.dev',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'null',
    ]);

    const allowOrigin = allowedOrigins.has(origin)
      ? origin
      : 'https://crypto-counsel.systemslibrarian.dev';

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return jsonError('Method not allowed', 405, corsHeaders);
    }

    if (env.RATE_LIMITER) {
      const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
      const { success } = await env.RATE_LIMITER.limit({ key: clientIp });
      if (!success) {
        return new Response(JSON.stringify({
          error: { message: 'Rate limit exceeded. Please wait a moment and try again.' }
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '30',
            ...corsHeaders,
          },
        });
      }
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('Invalid JSON body', 400, corsHeaders);
    }

    // --- Validate + sanitize the request before it touches the Groq key ---
    if (!body || typeof body !== 'object') {
      return jsonError('Request body must be a JSON object', 400, corsHeaders);
    }

    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonError('messages must be a non-empty array', 400, corsHeaders);
    }
    if (messages.length > MAX_MESSAGES) {
      return jsonError(`messages exceeds the limit of ${MAX_MESSAGES}`, 400, corsHeaders);
    }

    let totalChars = 0;
    const safeMessages = [];
    for (const m of messages) {
      if (!m || typeof m !== 'object' || !VALID_ROLES.has(m.role) || typeof m.content !== 'string') {
        return jsonError('each message needs a valid role and string content', 400, corsHeaders);
      }
      totalChars += m.content.length;
      if (totalChars > MAX_TOTAL_CHARS) {
        return jsonError('request prompt is too large', 413, corsHeaders);
      }
      safeMessages.push({ role: m.role, content: m.content });
    }

    const model = MODEL_ALLOWLIST.has(body.model) ? body.model : DEFAULT_MODEL;

    let maxTokens = Number.isInteger(body.max_tokens) ? body.max_tokens : DEFAULT_OUTPUT_TOKENS;
    maxTokens = Math.min(Math.max(maxTokens, 1), MAX_OUTPUT_TOKENS);

    let temperature = typeof body.temperature === 'number' ? body.temperature : 0.3;
    temperature = Math.min(Math.max(temperature, 0), 2);

    const safeBody = {
      model,
      messages: safeMessages,
      stream: body.stream === true,
      max_tokens: maxTokens,
      temperature,
    };

    try {
      const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify(safeBody),
      });

      const contentType = upstream.headers.get('Content-Type')
        || (safeBody.stream ? 'text/event-stream' : 'application/json');

      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, no-transform',
          ...corsHeaders,
        },
      });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Proxy request failed', 500, corsHeaders);
    }
  },
};
