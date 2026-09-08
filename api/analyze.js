export default async function handler(request, response) {
  try {

    /* ==========================================
       BASIC REQUEST CHECK
    ========================================== */

    if (request.method !== "POST") {
      return response.status(405).json({
        error: "Method not allowed"
      });
    }


    /* ==========================================
       READ REQUEST
    ========================================== */

    const body = request.body;

    if (!body || !body.front) {
      return response.status(400).json({
        error: "No card front image was received."
      });
    }


    const sport =
      body.sport || "Other";


    /* ==========================================
       BUILD IMAGE INPUT
    ========================================== */

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


    /* ==========================================
       MISTER E AI RESEARCH PROMPT
    ========================================== */

    const systemPrompt = `

You are MISTER E AI.

You are an expert trading-card identification,
research, collecting, and content-creation assistant.

Your job is to analyze the uploaded trading card,
identify it as accurately as possible, research the
card and the athlete/character using the web, and
then create a complete collector/content package.

SPORT / CATEGORY:
${sport}


IMPORTANT WORKFLOW:

STEP 1 — IDENTIFY THE CARD

Carefully examine the front and back images.

Identify as many of the following as possible:

- Athlete or character
- Sport
- Card year
- Manufacturer
- Brand
- Set
- Series
- Card number
- Rookie card status
- Insert
- Parallel
- Variation
- Serial numbering
- Autograph
- Memorabilia/relic
- Special features
- Visible condition observations


STEP 2 — RESEARCH THE CARD

You MUST use web search when possible.

Search for the identified card, set, athlete/character,
and relevant historical information.

Use reputable and relevant sources.

Prioritize:

- Manufacturer information
- Official athlete/team information
- Major sports organizations
- Reputable card databases
- Established hobby/card publications
- Reliable historical sources

Do not treat a random marketplace listing as proof
of a card's identity.

If sources disagree, acknowledge the uncertainty.


STEP 3 — RESEARCH THE ATHLETE OR CHARACTER

Find useful historical information that helps explain
why the athlete or character is significant.

For athletes, consider:

- Career
- Championships
- Awards
- Major accomplishments
- Hall of Fame status
- Important career moments
- Historical significance

For fictional characters, consider:

- Origin
- Important appearances
- Franchise significance
- Major storylines
- Historical importance


STEP 4 — EXPLAIN WHY THE CARD MATTERS

Create a concise explanation that a collector would
actually find interesting.

Do not simply repeat the card information.

Explain what makes this particular card interesting.


ACCURACY RULES:

- Never invent card information.
- Never invent historical facts.
- Never guess a card number.
- Never guess a parallel.
- Never guess a serial number.
- Never claim a card is a rookie unless supported.
- Never claim authenticity.
- Never assign a professional grade.
- Never give an exact market value unless specifically
  supported by reliable information.
- If something cannot be confirmed, say "Unknown" or
  "Not confirmed."
- Clearly distinguish visible information from researched
  information.


STEP 5 — CREATE CONTENT

After researching the card, create:

1. Card Information
2. History of the Card & Athlete / Character
3. Listing Description
4. Social Media Post Ideas
5. Hashtags
6. Content Ideas


RETURN ONLY VALID JSON.

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

Remember:

The card images are the primary source for
identification.

Web research is used to verify and expand the
historical information.

Accuracy is more important than filling every field.

`;


    /* ==========================================
       CALL OPENAI
    ========================================== */

    const openAIResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {

        method: "POST",

        headers: {

          "Content-Type":
            "application/json",

          "Authorization":
            `Bearer ${process.env.OPENAI_API_KEY}`

        },

        body: JSON.stringify({

          model:
            process.env.OPENAI_MODEL ||
            "gpt-5.6-luna",


          /* Force the model to have access
             to current web information */

          tools: [
            {
              type: "web_search"
            }
          ],


          /* Require the model to use a tool */

          tool_choice:
            "required",


          input: [

            /* ==========================
               SYSTEM INSTRUCTIONS
            =========================== */

            {
              role: "system",

              content: [

                {
                  type: "input_text",

                  text:
                    systemPrompt

                }

              ]

            },


            /* ==========================
               CARD IMAGES
            =========================== */

            {
              role: "user",

              content: [

                ...images,

                {

                  type: "input_text",

                  text: `
Analyze these trading card images.

First identify the card as accurately as possible.

Then use web search to research the card,
the set, and the athlete or character.

Finally create the complete MISTER E AI
collector and creator package.

Do not invent information.
`
                }

              ]

            }

          ]

        })

      }
    );


    /* ==========================================
       READ OPENAI RESPONSE
    ========================================== */

    const resultText =
      await openAIResponse.text();


    if (!openAIResponse.ok) {

      console.error(
        "OpenAI API Error:",
        resultText
      );


      return response
        .status(openAIResponse.status)
        .json({

          error:
            "OpenAI request failed.",

          details:
            resultText

        });

    }


    const data =
      JSON.parse(resultText);


    /* ==========================================
       COLLECT MODEL TEXT
    ========================================== */

    let outputText = "";


    if (Array.isArray(data.output)) {

      for (
        const item of data.output
      ) {

        if (
          Array.isArray(
            item.content
          )
        ) {

          for (
            const content
            of item.content
          ) {

            if (
              content.type ===
                "output_text" &&
              content.text
            ) {

              outputText +=
                content.text;

            }

          }

        }

      }

    }


    if (!outputText) {

      return response.status(500).json({

        error:
          "OpenAI returned no text output.",

        details:
          data

      });

    }


    /* ==========================================
       PARSE JSON
    ========================================== */

    let result;


    try {

      result =
        JSON.parse(outputText);

    } catch (error) {

      console.error(
        "JSON parsing error:",
        outputText
      );


      return response.status(500).json({

        error:
          "OpenAI returned text that was not valid JSON.",

        raw:
          outputText

      });

    }


    /* ==========================================
       COLLECT WEB SOURCES
    ========================================== */

    const sources = [];


    if (
      Array.isArray(data.output)
    ) {

      for (
        const item of data.output
      ) {

        if (
          Array.isArray(
            item.content
          )
        ) {

          for (
            const content
            of item.content
          ) {

            if (
              Array.isArray(
                content.annotations
              )
            ) {

              for (
                const annotation
                of content.annotations
              ) {

                if (
                  annotation.type ===
                  "url_citation"
                ) {

                  const url =
                    annotation.url;

                  const title =
                    annotation.title ||
                    url;


                  if (
                    url &&
                    !sources.some(
                      source =>
                        source.url === url
                    )
                  ) {

                    sources.push({

                      title:
                        title,

                      url:
                        url

                    });

                  }

                }

              }

            }

          }

        }

      }

    }


    /* ==========================================
       RETURN COMPLETE RESULT
    ========================================== */

    return response.status(200).json({

      ...result,

      research_sources:
        sources

    });


  } catch (error) {

    console.error(
      "MISTER E AI ERROR:",
      error
    );


    return response.status(500).json({

      error:
        error.message ||
        "Something went wrong analyzing the card."

    });

  }

}
