// api/gemini.js

export default async function handler(req, res) {
  // 1. Handle CORS Preflight or wrong methods
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
    
    // Safety check for empty incoming messages
    if (!body || !body.messages || body.messages.length === 0) {
      return res.status(400).json({ error: 'Missing messages in request body' });
    }

    const incomingContent = body.messages[0].content;
    const geminiParts = [];

    // 2. Parse the frontend payload into Gemini's format
    if (typeof incomingContent === 'string') {
      // Text-only fallback if frontend sends a simple string
      geminiParts.push({ text: incomingContent });
    } else if (Array.isArray(incomingContent)) {
      // Handle the array format (Text + Images)
      for (const part of incomingContent) {
        if (part.type === 'text') {
          geminiParts.push({ text: part.text });
        } else if (part.type === 'image') {
          // Safely extract base64 data regardless of nested structure
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

    // 3. Construct the official Gemini payload
    const geminiPayload = {
      contents: [{
        role: 'user',
        parts: geminiParts
      }],
      generationConfig: {
        maxOutputTokens: body.max_tokens || 1000,
        temperature: 0.7
      }
    };

    // 4. Send the request to Google
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const googleResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    const googleData = await googleResponse.json();

    // Log errors from Google directly into Vercel logs for debugging
    if (!googleResponse.ok) {
      console.error("Google API Error Response:", JSON.stringify(googleData));
      return res.status(googleResponse.status).json({ 
        error: googleData.error?.message || 'Error from Gemini API' 
      });
    }

    // 5. Extract the generated text safely
    const aiText = googleData.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!aiText) {
      console.error("Unexpected Gemini response structure:", JSON.stringify(googleData));
      return res.status(502).json({ error: 'Invalid response structure received from AI' });
    }

    // 6. Map back exactly to the format your frontend expects
    const formattedResponse = {
      content: [
        {
          type: 'text',
          text: aiText
        }
      ]
    };

    return res.status(200).json(formattedResponse);

  } catch (error) {
    console.error("Serverless Function Crash:", error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
