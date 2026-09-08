export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const body = request.body || {};

    const front = body.front;
    const back = body.back || null;
    const sport = body.sport || "Auto Detect";

    if (!front) {
      return response.status(400).json({
        error: "Front image is required."
      });
    }

    const images = [
      {
        type: "input_image",
        image_url: `data:image/jpeg;base64,${front}`
      }
    ];

    if (back) {
      images.push({
        type: "input_image",
        image_url: `data:image/jpeg;base64,${back}`
      });
    }

    /*
     * Keep the prompt short and focused.
     * The previous version was generating a very large request,
     * which contributed to the TPM rate-limit problem.
     */

    const prompt = `
You are MISTER E AI, an expert trading-card identification and research assistant.

Analyze the uploaded trading card ${back ? "front and back" : "front"}.

Category selected by user: ${sport}

Use web research to verify important identification and historical facts.

Priorities:
1. Identify the exact card when possible.
2. Research the card/set and athlete or character.
3. Create useful content for a collector or seller.

IMPORTANT ACCURACY RULES:
- Never invent card numbers, parallels, serial numbers, print runs, or dates.
- Never call a card a rookie card unless reliable evidence supports it.
- Never claim a card is authentic.
- Never assign a professional grade.
- Do not provide an exact market value unless reliable research clearly supports it.
- If something cannot be verified, say "Not verified."
- Separate what is visible on the card from information learned through research.

Return ONLY valid JSON. No markdown. No explanation outside the JSON.

Use exactly this structure:

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
  "why_this_card_matters": "",
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

Keep every field concise but useful.
`;

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return response.status(500).json({
        error: "OPENAI_API_KEY is not configured."
      });
    }

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },

        body: JSON.stringify({
          model: "gpt-5.6-luna",

          input: [
            {
              role: "user",
              content: [
                ...images,
                {
                  type: "input_text",
                  text: prompt
                }
              ]
            }
          ],

          tools: [
            {
              type: "web_search"
            }
          ],

          tool_choice: "required",

          /*
           * Limit the amount of generated text.
           * This helps keep requests predictable and efficient.
           */
          max_output_tokens: 6000
        })
      }
    );

    const data = await openaiResponse.json();

    if (!openaiResponse.ok) {
      console.error(
        "OpenAI API Error:",
        JSON.stringify(data, null, 2)
      );

      return response.status(openaiResponse.status).json({
        error:
          data?.error?.message ||
          "OpenAI request failed."
      });
    }

    /*
     * Extract text from the raw Responses API response.
     */
    let outputText = "";

    const output = Array.isArray(data.output)
      ? data.output
      : [];

    for (const item of output) {
      if (!Array.isArray(item.content)) {
        continue;
      }

      for (const content of item.content) {
        if (
          content &&
          content.type === "output_text" &&
          typeof content.text === "string"
        ) {
          outputText += content.text;
        }
      }
    }

    if (!outputText) {
      console.error(
        "OpenAI returned no output text:",
        JSON.stringify(data, null, 2)
      );

      return response.status(500).json({
        error:
          "OpenAI returned no analysis."
      });
    }

    /*
     * Clean possible markdown code fences just in case.
     */
    outputText = outputText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let result;

    try {
      result = JSON.parse(outputText);
    } catch (parseError) {

      console.error(
        "JSON Parse Error:",
        parseError
      );

      console.error(
        "OpenAI Output:",
        outputText
      );

      return response.status(500).json({
        error:
          "MISTER E AI returned an invalid analysis format."
      });
    }

    /*
     * Extract web research citations.
     */
    const sources = [];

    for (const item of output) {

      if (!Array.isArray(item.content)) {
        continue;
      }

      for (const content of item.content) {

        if (
          content &&
          Array.isArray(content.annotations)
        ) {

          for (
            const annotation
            of content.annotations
          ) {

            if (
              annotation &&
              annotation.type === "url_citation"
            ) {

              const url =
                annotation.url ||
                annotation.href;

              const title =
                annotation.title ||
                "Research Source";

              if (
                url &&
                !sources.some(
                  source =>
                    source.url === url
                )
              ) {

                sources.push({
                  title,
                  url
                });

              }

            }

          }

        }

      }

    }

    /*
     * Also check top-level output items for citations,
     * because the Responses API can expose annotations
     * in slightly different locations.
     */
    for (const item of output) {

      if (
        item &&
        Array.isArray(item.annotations)
      ) {

        for (
          const annotation
          of item.annotations
        ) {

          if (
            annotation &&
            annotation.type === "url_citation"
          ) {

            const url =
              annotation.url ||
              annotation.href;

            const title =
              annotation.title ||
              "Research Source";

            if (
              url &&
              !sources.some(
                source =>
                  source.url === url
              )
            ) {

              sources.push({
                title,
                url
              });

            }

          }

        }

      }

    }

    /*
     * Keep the number of displayed sources reasonable.
     */
    result.research_sources =
      sources.slice(0, 8);

    return response.status(200).json(result);

  } catch (error) {

    console.error(
      "Server Error:",
      error
    );

    return response.status(500).json({
      error:
        error?.message ||
        "Something went wrong while analyzing the card."
    });

  }
}
