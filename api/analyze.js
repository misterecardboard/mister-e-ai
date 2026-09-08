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
     * Build the image input.
     */

    const cardContent = [
      {
        type: "input_image",
        image_url: `data:image/jpeg;base64,${front}`
      }
    ];

    if (back) {
      cardContent.push({
        type: "input_image",
        image_url: `data:image/jpeg;base64,${back}`
      });
    }

    /*
     * Compact prompt.
     *
     * The goal is identification + focused research,
     * not a giant reasoning process.
     */

    cardContent.push({
      type: "input_text",
      text: `
You are MISTER E AI, a trading-card identification and research tool.

Identify this card and use web search to verify the important facts.

Category: ${sport}

Focus on:
- exact card/set identification
- athlete or character
- year
- brand
- set
- card number
- parallel/variant
- rookie status
- important card history
- important athlete/character history

Accuracy rules:
- Never invent information.
- If uncertain, say "Not verified."
- Never claim authenticity.
- Never assign a professional grade.
- Never invent a market value.

Then create concise collector/seller content.

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
     * OpenAI Responses API.
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

          /*
           * No extra reasoning for this high-volume task.
           * This is the biggest token-saving change.
           */
          reasoning: {
            effort: "none"
          },

          input: [
            {
              role: "user",
              content: cardContent
            }
          ],

          /*
           * Web research remains enabled.
           */
          tools: [
            {
              type: "web_search"
            }
          ],

          /*
           * Require the research tool.
           */
          tool_choice: "required",

          /*
           * Keep generated output compact.
           */
          max_output_tokens: 3000
        })
      }
    );

    const data = await openaiResponse.json();

    /*
     * OpenAI error.
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
     * Extract text from Responses API.
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
     * Parse the JSON.
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
     * ---------------------------------------------------------
     * FIND RESEARCH SOURCES
     * ---------------------------------------------------------
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
     * Recursively inspect the entire Responses API result.
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

      /*
       * Standard URL citation.
       */

      if (
        value.type === "url_citation"
      ) {
        addSource(
          value.url,
          value.title
        );
      }

      /*
       * Nested citation.
       */

      if (
        value.url_citation &&
        typeof value.url_citation === "object"
      ) {
        addSource(
          value.url_citation.url,
          value.url_citation.title
        );
      }

      /*
       * Some web-search result structures expose
       * the URL directly.
       */

      if (
        typeof value.url === "string" &&
        (
          value.title ||
          value.type === "source" ||
          value.type === "citation" ||
          value.type === "url_citation"
        )
      ) {
        addSource(
          value.url,
          value.title
        );
      }

      /*
       * Continue scanning nested objects.
       */

      for (const key of Object.keys(value)) {
        scan(value[key]);
      }
    }

    scan(data);

    /*
     * Explicitly inspect output annotations too.
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
            annotation.type === "url_citation"
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
     * Return up to 8 research sources.
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

    /*
     * Return the finished result.
     */

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
