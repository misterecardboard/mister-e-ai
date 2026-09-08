export default async function handler(request) {
  try {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        {
          status: 405,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const formData = await request.formData();

    const front = formData.get("front");
    const back = formData.get("back");
    const sport = formData.get("sport") || "Other";

    if (!front) {
      return new Response(
        JSON.stringify({
          error: "Please upload the front of the card."
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    async function fileToDataUrl(file) {
      const bytes = await file.arrayBuffer();

      let binary = "";
      const data = new Uint8Array(bytes);

      for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
      }

      const base64 = btoa(binary);
      const mime = file.type || "image/jpeg";

      return `data:${mime};base64,${base64}`;
    }

    const frontImage = await fileToDataUrl(front);
    const backImage = back
      ? await fileToDataUrl(back)
      : null;

    const images = [
      {
        type: "input_image",
        image_url: frontImage
      }
    ];

    if (backImage) {
      images.push({
        type: "input_image",
        image_url: backImage
      });
    }

    const response = await fetch(
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
- Do not assign a professional grade.
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
Explain the history of the card/set and the athlete or character. Do not invent specific historical facts.

Listing Description:
Write an attractive marketplace listing.

Social Media Post Ideas:
Create three different social media post ideas.

Hashtags:
Provide useful hashtags for the card.

Content Ideas:
Create five video/content ideas a collector could make using this card.
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

    if (!response.ok) {
      const errorText = await response.text();

      return new Response(
        JSON.stringify({
          error: "OpenAI request failed.",
          details: errorText
        }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const data = await response.json();

    const text = data.output_text;

    let result;

    try {
      result = JSON.parse(text);
    } catch {
      result = {
        error: "The AI returned an unexpected response.",
        raw: text
      };
    }

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (error) {

    console.error(error);

    return new Response(
      JSON.stringify({
        error:
          error?.message ||
          "Something went wrong analyzing the card."
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
