const DAILY_LIMIT = 10;
const ipRequests = {};

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function checkRateLimit(ip) {
  const key = `${ip}::${getToday()}`;
  const count = ipRequests[key] || 0;
  if (count >= DAILY_LIMIT) return false;
  ipRequests[key] = count + 1;
  return true;
}

function getRemaining(ip) {
  const key = `${ip}::${getToday()}`;
  return DAILY_LIMIT - (ipRequests[key] || 0);
}

function toGeminiContents(messages, system) {
  const contents = [];
  if (system) {
    contents.push({ role: 'user', parts: [{ text: `[Instructions]: ${system}` }] });
    contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
  }
  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts = [];
    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text') parts.push({ text: block.text });
        if (block.type === 'image') {
          parts.push({
            inline_data: {
              mime_type: block.source.media_type,
              data: block.source.data
            }
          });
        }
      }
    }
    contents.push({ role, parts });
  }
  return contents;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    'unknown';

  if (!checkRateLimit(ip)) {
    return res.status(429).json({
      error: 'Daily limit reached',
      message: "You've used all 10 free AI requests for today. Come back tomorrow! 🌅",
      remaining: 0
    });
  }

  const remaining = getRemaining(ip);

  try {
    const body = req.body;
    if (!body?.messages) return res.status(400).json({ error: 'Invalid request' });

    const contents = toGeminiContents(body.messages, body.system);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: body.max_tokens || 1000,
          temperature: 0.7
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || 'Gemini API error'
      });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return res.status(200).json({
      content: [{ type: 'text', text }],
      _meta: { remaining, limit: DAILY_LIMIT }
    });

  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
