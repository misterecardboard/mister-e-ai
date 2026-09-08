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

    const prompt = `
You are MISTER E AI, an expert trading-card identification and research assistant.

Analyze the uploaded trading card.

Category: ${sport}

You MUST use web search to research the card and athlete/character.

Identify the card as accurately as possible, then provide useful information for a collector or seller.

ACCURACY:
- Never invent card numbers, parallels, serial numbers, print runs, or dates.
- Never call something a rookie card unless supported by research.
- Never claim authenticity.
- Never assign a professional grade.
- Never invent market values.
- If something cannot be verified, say "Not verified."

Return ONLY valid JSON.

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

Keep answers concise.
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
     * ---------------------------------------------------------
     * GET THE MODEL'S TEXT
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
        "No output text:",
        JSON.stringify(data, null, 2)
      );

      return response.status(500).json({
        error: "OpenAI returned no analysis."
      });
    }

    outputText = outputText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let result;

    try {
      result = JSON.parse(outputText);
    } catch (error) {
      console.error(
        "JSON Parse Error:",
        error
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
     * ---------------------------------------------------------
     * EXTRACT WEB SEARCH SOURCES
     *
     * OpenAI Responses can place URL citations inside
     * output_text annotations. We inspect the complete
     * response recursively instead of assuming one location.
     * ---------------------------------------------------------
     */

    const sources = [];

    function addSource(url, title) {
      if (!url || typeof url !== "string") {
        return;
      }

      let cleanUrl = url.trim();

      if (!cleanUrl) {
        return;
      }

      /*
       * Only accept actual web URLs.
       */
      if (
        !cleanUrl.startsWith("http://") &&
        !cleanUrl.startsWith("https://")
      ) {
        return;
      }

      /*
       * Prevent duplicate sources.
       */
      const exists = sources.some(
        source => source.url === cleanUrl
      );

      if (exists) {
        return;
      }

      sources.push({
        title:
          typeof title === "string" && title.trim()
            ? title.trim()
            : "Research Source",

        url: cleanUrl
      });
    }


    /*
     * Recursively inspect every object and array in the
     * Responses API result for URL citation information.
     */
    function scanForSources(value) {

      if (!value) {
        return;
      }

      if (Array.isArray(value)) {

        for (const item of value) {
          scanForSources(item);
        }

        return;
      }

      if (
        typeof value !== "object"
      ) {
        return;
      }


      /*
       * Standard URL citation format.
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
       * Some response structures may expose the
       * citation information under a nested object.
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
       * Look for common URL/title combinations.
       */
      if (
        typeof value.url === "string"
      ) {

        const looksLikeSource =
          value.type === "url_citation" ||
          value.type === "citation" ||
          value.type === "source" ||
          value.title ||
          value.name;

        if (looksLikeSource) {

          addSource(
            value.url,
            value.title ||
            value.name
          );

        }

      }


      /*
       * Continue scanning nested properties.
       */
      for (
        const key of Object.keys(value)
      ) {

        scanForSources(
          value[key]
        );

      }

    }


    scanForSources(data);


    /*
     * ---------------------------------------------------------
     * FALLBACK:
     *
     * If the API response contains URL annotations attached
     * to output text, explicitly inspect those too.
     * ---------------------------------------------------------
     */

    for (const item of output) {

      if (
        !item ||
        !Array.isArray(item.content)
      ) {
        continue;
      }

      for (
        const content
        of item.content
      ) {

        if (
          !content ||
          !Array.isArray(
            content.annotations
          )
        ) {
          continue;
        }

        for (
          const annotation
          of content.annotations
        ) {

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
     * Keep the UI clean.
     */
    result.research_sources =
      sources.slice(0, 10);


    /*
     * Helpful server-side logging while we test this.
     */
    console.log(
      "Research sources found:",
      result.research_sources
    );


    return response.status(200).json(
      result
    );

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
