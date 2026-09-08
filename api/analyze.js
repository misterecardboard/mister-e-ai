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

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return response.status(500).json({
        error: "OPENAI_API_KEY is not configured."
      });
    }

    /*
     * Build the card images.
     * Low detail is used to reduce image-token usage while
     * keeping the image large enough for card identification.
     */

    const cardContent = [
      {
        type: "input_image",
        image_url: `data:image/jpeg;base64,${front}`,
        detail: "low"
      }
    ];

    if (back) {
      cardContent.push({
        type: "input_image",
        image_url: `data:image/jpeg;base64,${back}`,
        detail: "low"
      });
    }

    /*
     * Keep the instruction compact.
     * The goal is accurate card identification and useful
     * collector/seller content without unnecessary output.
     */

    cardContent.push({
      type: "input_text",
      text: `
You are MISTER E AI.

Identify and research the trading card shown in the images.

Category: ${sport}

Use web search to verify important facts.

Prioritize:
- exact card/set
- athlete or character
- year
- brand
- set
- card number
- parallel/variant
- rookie status
- important card history
- important athlete/character history

Rules:
- Never invent facts.
- If something cannot be verified, say "Not verified."
- Do not claim authenticity.
- Do not assign a professional grade.
- Do not invent market value.

Return ONLY valid JSON.

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

Keep every field concise.
`
    });

    /*
     * OpenAI Responses API
     */

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

          reasoning: {
            effort: "none"
          },

          input: [
            {
              role: "user",
              content: cardContent
            }
          ],

          tools: [
            {
              type: "web_search"
            }
          ],

          tool_choice: "required",

          /*
           * Keep the maximum response deliberately small.
           * MISTER E AI does not need thousands of words
           * to produce the six requested sections.
           */
          max_output_tokens: 2200
        })
      }
    );

    const data = await openaiResponse.json();

    /*
     * Handle OpenAI errors.
     */

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
     * Extract the model's text from the raw Responses API.
     */

    let outputText = "";

    const output = Array.isArray(data.output)
      ? data.output
      : [];

    for (const item of output) {
      if (!Array.isArray(item.content)) {
        continue;
      }

      for (const part of item.content) {
        if (
          part &&
          part.type === "output_text" &&
          typeof part.text === "string"
        ) {
          outputText += part.text;
        }
      }
    }

    if (!outputText) {
      console.error(
        "OpenAI returned no output text:",
        JSON.stringify(data, null, 2)
      );

      return response.status(500).json({
        error: "OpenAI returned no analysis."
      });
    }

    /*
     * Remove accidental markdown fences.
     */

    outputText = outputText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    /*
     * Parse JSON.
     */

    let result;

    try {
      result = JSON.parse(outputText);
    } catch (error) {
      console.error(
        "JSON Parse Error:",
        error
      );

      console.error(
        "Model Output:",
        outputText
      );

      return response.status(500).json({
        error:
          "MISTER E AI returned an invalid analysis format."
      });
    }

    /*
     * Collect research sources.
     */

    const sources = [];

    function addSource(url, title) {
      if (
        typeof url !== "string" ||
        !url.trim()
      ) {
        return;
      }

      const cleanUrl = url.trim();

      if (
        !cleanUrl.startsWith("http://") &&
        !cleanUrl.startsWith("https://")
      ) {
        return;
      }

      if (
        sources.some(
          source => source.url === cleanUrl
        )
      ) {
        return;
      }

      sources.push({
        title:
          typeof title === "string" &&
          title.trim()
            ? title.trim()
            : "Research Source",

        url: cleanUrl
      });
    }

    /*
     * IMPORTANT:
     * Web Search sources are returned inside
     * web_search_call -> action -> sources.
     */

    for (const item of output) {
      if (
        item &&
        item.type === "web_search_call"
      ) {
        const searchSources =
          item.action?.sources || [];

        if (Array.isArray(searchSources)) {
          for (const source of searchSources) {
            addSource(
              source?.url,
              source?.title
            );
          }
        }
      }
    }

    /*
     * Also scan annotations in case the API
     * returns URL citations there.
     */

    for (const item of output) {
      if (
        !item ||
        !Array.isArray(item.content)
      ) {
        continue;
      }

      for (const part of item.content) {
        if (
          !part ||
          !Array.isArray(part.annotations)
        ) {
          continue;
        }

        for (const annotation of part.annotations) {
          if (
            annotation &&
            annotation.type ===
              "url_citation"
          ) {
            addSource(
              annotation.url,
              annotation.title
            );
          }
        }
      }
    }

    /*
     * Final fallback recursive scan.
     */

    function scan(value) {
      if (!value) {
        return;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          scan(item);
        }

        return;
      }

      if (typeof value !== "object") {
        return;
      }

      if (value.type === "url_citation") {
        addSource(
          value.url,
          value.title
        );
      }

      if (
        value.url_citation &&
        typeof value.url_citation ===
          "object"
      ) {
        addSource(
          value.url_citation.url,
          value.url_citation.title
        );
      }

      for (const key of Object.keys(value)) {
        scan(value[key]);
      }
    }

    scan(data);

    /*
     * Limit displayed sources.
     */

    result.research_sources =
      sources.slice(0, 8);

    console.log(
      "MISTER E AI sources:",
      JSON.stringify(
        result.research_sources,
        null,
        2
      )
    );

    return response.status(200).json(result);

  } catch (error) {
    console.error(
      "MISTER E AI server error:",
      error
    );

    return response.status(500).json({
      error:
        error?.message ||
        "Something went wrong while analyzing the card."
    });
  }
}
