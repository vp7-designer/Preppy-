export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Vercel Error: GEMINI_API_KEY environment variable is missing.");
    return res.status(500).json({ error: 'Server configuration error: Missing API Key' });
  }

  try {
    const body = req.body;
    
    if (!body || !body.messages || body.messages.length === 0) {
      return res.status(400).json({ error: 'Missing messages in request body' });
    }

    const incomingContent = body.messages[0].content;
    const geminiParts = [];

    // Parse incoming payload into Gemini's structure
    if (typeof incomingContent === 'string') {
      geminiParts.push({ text: incomingContent });
    } else if (Array.isArray(incomingContent)) {
      for (const part of incomingContent) {
        if (part.type === 'text') {
          geminiParts.push({ text: part.text });
        } else if (part.type === 'image') {
          const base64Data = part.source?.data || part.data;
          const mimeType = part.source?.media_type || part.mime_type || 'image/jpeg';
          
          if (base64Data) {
            geminiParts.push({
              inline_data: {
                mime_type: mimeType,
                data: base64Data
              }
            });
          }
        }
      }
    }

    const geminiPayload = {
      contents: [{ role: 'user', parts: geminiParts }],
      generationConfig: {
        maxOutputTokens: body.max_tokens || 1000,
        temperature: 0.7
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const googleResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    const googleData = await googleResponse.json();

    if (!googleResponse.ok) {
      console.error("Google API Error Response:", JSON.stringify(googleData));
      return res.status(googleResponse.status).json({ 
        error: googleData.error?.message || 'Error from Gemini API' 
      });
    }

    const aiText = googleData.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!aiText) {
      console.error("Unexpected Gemini response structure:", JSON.stringify(googleData));
      return res.status(502).json({ error: 'Invalid response structure received from AI' });
    }

    // Map back to the format your frontend expects
    return res.status(200).json({
      content: [{ type: 'text', text: aiText }]
    });

  } catch (error) {
    console.error("Serverless Function Crash:", error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
