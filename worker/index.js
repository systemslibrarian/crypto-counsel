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
      return new Response(null, {
        headers: corsHeaders
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: { message: 'Method not allowed' } }), {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        }
      });
    }

    try {
      const body = await request.json();

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.GROQ_API_KEY}`
        },
        body: JSON.stringify(body)
      });

      const result = await response.text();

      return new Response(result, {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({
        error: {
          message: err instanceof Error ? err.message : 'Proxy request failed'
        }
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        }
      });
    }
  }
};
