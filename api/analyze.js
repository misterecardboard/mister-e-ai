export default async function handler(request, response) {
  try {
    if (request.method !== "POST") {
      return response.status(405).json({
        error: "Method not allowed"
      });
    }

    const body = request.body;

    if (!body || !body.front) {
      return response.status(400).json({
        error: "No card front image was received."
      });
    }

    const sport = body.sport || "Other";

    const images = [
      {
        type: "input_image",
        image_url: body.front
      }
    ];

    if (body.back) {
      images.push({
        type: "input_image",
        image_url: body.back
      });
    }

    const openAIResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-5.6-luna",

          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: `
You are Mister E AI, an expert trading-card assistant.

Analyze the uploaded trading card carefully.

Sport/category:
${sport}

Use both the front and back when both are provided.

IMPORTANT:
- Never invent card information.
- Only provide details that can be confirmed from the images or reliable general knowledge.
- If something cannot be confirmed, say "Unknown" or "Not confirmed."
- Do not assign a professional card grade.
- Do not claim an exact market value.
- Do not claim authenticity unless it can actually be established.
- Make the results useful to collectors, sellers, and content creators.

Return ONLY valid JSON in this exact structure:

{
  "card_information": {
    "title": "",
    "athlete_or_character": "",
    "sport": "",
    "year": "",
    "brand": "",
    "set": "",
    "card_number": "",
    "parallel_or_variant": "",
    "rookie_card": "",
    "special_features": "",
    "condition_observations": ""
  },

  "history": {
    "card_history": "",
    "athlete_or_character_history": ""
  },

  "listing_description": "",

  "social_media_post_ideas": [
    "",
    "",
    ""
  ],

  "hashtags": [
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ],

  "content_ideas": [
    "",
    "",
    "",
    "",
    ""
  ]
}

Card Information:
Identify as many confirmed details as possible.

History:
Explain the history of the card/set and the athlete or character.
Do not invent specific historical facts.

Listing Description:
Write an attractive marketplace listing.

Social Media Post Ideas:
Create three different social media post ideas.

Hashtags:
Provide useful hashtags for the card.

Content Ideas:
Create five video/content ideas a collector could make using this card.

Accuracy is more important than filling every field.
`
                }
              ]
            },

            {
              role: "user",
              content: [
                ...images,
                {
                  type: "input_text",
                  text: "Analyze this trading card and create the complete Mister E AI content package."
                }
              ]
            }
          ]
        })
      }
    );

    const resultText = await openAIResponse.text();

    if (!openAIResponse.ok) {
      return response.status(openAIResponse.status).json({
        error: "OpenAI request failed.",
        details: resultText
      });
    }

const data = JSON.parse(resultText);

let outputText = "";

if (Array.isArray(data.output)) {
  for (const item of data.output) {
    if (Array.isArray(item.content)) {
      for (const content of item.content) {
        if (content.type === "output_text" && content.text) {
          outputText += content.text;
        }
      }
    }
  }
}

if (!outputText) {
  return response.status(500).json({
    error: "OpenAI returned no text output.",
    details: data
  });
}

let result;

try {
  result = JSON.parse(outputText);
} catch {
  return response.status(500).json({
    error: "OpenAI returned text that was not valid JSON.",
    raw: outputText
  });
}

    return response.status(200).json(result);

  } catch (error) {

    console.error(error);

    return response.status(500).json({
      error: error.message || "Something went wrong analyzing the card."
    });
  }
}
