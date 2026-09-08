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
     * ---------------------------------------------------------
     * IMAGES
     * ---------------------------------------------------------
     */

    const content = [
      {
        type: "input_image",
        image_url: `data:image/jpeg;base64,${front}`
      }
    ];

    if (back) {
      content.push({
        type: "input_image",
        image_url: `data:image/jpeg;base64,${back}`
      });
    }

    /*
     * ---------------------------------------------------------
     * COMPACT PROMPT
     *
     * Keep this intentionally short.
     * The images provide the visual information.
     * Web search provides verification.
     * ---------------------------------------------------------
     */

    content.push({
      type: "input_text",
      text: `
You are MISTER E AI, a trading-card identification and research assistant.

Identify the uploaded card as accurately as possible.

Category: ${sport}

Use web search to verify the card and athlete/character.

Prioritize:
- year
- brand
- set
- card number
- athlete/character
- variant/parallel
- rookie status
- important card history
- important athlete/character history

Never invent information.
If something cannot be verified, write "Not verified."
Do not claim authenticity.
Do not assign a professional grade.
Do not invent market value.

Then create concise collector/seller content.

Return ONLY valid JSON with this structure:

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
  "social_media_post_ideas": ["", "", ""],
  "hashtags": ["", "", "", "", "", "", "", ""],
  "content_ideas": ["", "", "", "", ""]
}

Keep every answer concise.
`
    });

    /*
     * ---------------------------------------------------------
     * OPENAI REQUEST
     * ---------------------------------------------------------
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

          input: [
            {
              role: "user",
              content
            }
          ],

          /*
           * Web research is required because MISTER E AI
           * is specifically a research product.
           */
          tools: [
            {
              type: "web_search"
            }
          ],

          tool_choice: "required",

          /*
           * Keep output deliberately compact.
           */
          max_output_tokens: 3500
        })
      }
    );

    const data = await openaiResponse.json();

    /*
     * ---------------------------------------------------------
     * ERROR HANDLING
     * ---------------------------------------------------------
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
     * ---------------------------------------------------------
     * EXTRACT MODEL TEXT
     * ---------------------------------------------------------
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
        "No output text returned:",
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
     * ---------------------------------------------------------
     * PARSE JSON
     * ---------------------------------------------------------
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
     * RESEARCH SOURCES
     *
     * Look for web-search source information anywhere in
     * the Responses API result.
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


    function inspect(value) {
      if (!value) {
        return;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          inspect(item);
        }
        return;
      }

      if (typeof value !== "object") {
        return;
      }

      /*
       * Direct URL citation.
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
       * Nested URL citation.
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
       * Web-search source-like object.
       */
      if (
        typeof value.url === "string" &&
        (
          value.type === "source" ||
          value.type === "citation" ||
          value.type === "url_citation" ||
          value.title
        )
      ) {
        addSource(
          value.url,
          value.title
        );
      }

      /*
       * Continue through nested response data.
       */
      for (const key of Object.keys(value)) {
        inspect(value[key]);
      }
    }

    inspect(data);

    /*
     * Also inspect annotations attached to output text.
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
     * Keep only the first 8 sources.
     */
    result.research_sources =
      sources.slice(0, 8);

    console.log(
      "MISTER E AI research sources:",
      JSON.stringify(
        result.research_sources,
        null,
        2
      )
    );

    /*
     * ---------------------------------------------------------
     * RETURN RESULT
     * ---------------------------------------------------------
     */

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
