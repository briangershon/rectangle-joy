(() => {
  const AGENT_SYSTEM_PROMPT = [
    "You translate natural-language prompts into rectangle generation settings.",
    'Respond with valid JSON matching: { "color": string, "count": number, "minSize": number, "maxSize": number }.',
    "Rules:",
    "- color: CSS hex string (#rrggbb).",
    "- count: integer 500-5000.",
    "- minSize: integer 20-40.",
    "- maxSize: integer 60-80 and >= minSize.",
    "Omitted values should fall back to sensible defaults within range.",
  ].join(" ");

  const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

  const RECT_CONFIG_JSON_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
      color: {
        type: "string",
        pattern: "^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$",
      },
      count: {
        type: "integer",
        minimum: 500,
        maximum: 5000,
      },
      minSize: {
        type: "integer",
        minimum: 20,
        maximum: 40,
      },
      maxSize: {
        type: "integer",
        minimum: 60,
        maximum: 80,
      },
    },
    required: ["color", "count", "minSize", "maxSize"],
  };

  function isApiKeyAvailable() {
    return (
      typeof window !== "undefined" &&
      typeof window.OPENAI_API_KEY === "string" &&
      window.OPENAI_API_KEY.trim().length > 0
    );
  }

  async function requestRectangleConfig(userPrompt) {
    if (!isApiKeyAvailable()) {
      throw new Error("Missing OpenAI API key.");
    }

    const payload = {
      model: "gpt-4o-mini",
      temperature: 0.2,
      input: [
        { role: "system", content: AGENT_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "rectangle_config",
          schema: RECT_CONFIG_JSON_SCHEMA,
        },
      },
    };

    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${window.OPENAI_API_KEY}`,
        "OpenAI-Beta": "responses=v1",
      },
      body: JSON.stringify(payload),
    });

    const rawBody = await response.text();
    if (!response.ok) {
      let message = `OpenAI error ${response.status}`;
      try {
        const errorPayload = JSON.parse(rawBody);
        if (errorPayload?.error?.message) {
          message = errorPayload.error.message;
        }
      } catch (parseError) {
        if (rawBody) message = `${message}: ${rawBody}`;
      }
      throw new Error(message);
    }

    let data;
    try {
      data = JSON.parse(rawBody);
    } catch (parseError) {
      throw new Error("Failed to parse OpenAI response.");
    }

    return parseModelResponse(data);
  }

  function parseModelResponse(data) {
    const content = extractResponseText(data);
    const jsonBlock = extractJsonBlock(content);
    if (!jsonBlock) {
      throw new Error("Model response missing JSON block.");
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonBlock);
    } catch (error) {
      throw new Error("Model returned invalid JSON.");
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Model returned unsupported payload.");
    }

    return parsed;
  }

  function extractResponseText(data) {
    if (!data || typeof data !== "object") return "";

    if (Array.isArray(data.output)) {
      const buffer = [];
      for (const item of data.output) {
        if (item?.type === "message" && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part?.type === "output_text" && typeof part.text === "string") {
              buffer.push(part.text);
            }
          }
        }
      }
      if (buffer.length) return buffer.join("\n");
    }

    if (Array.isArray(data.output_text)) {
      const joined = data.output_text
        .filter((t) => typeof t === "string")
        .join("\n");
      if (joined) return joined;
    }

    if (typeof data.content === "string") return data.content;

    return "";
  }

  function extractJsonBlock(text) {
    if (!text) return null;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    return text.slice(start, end + 1);
  }

  window.LLMRectangles = {
    isApiKeyAvailable,
    requestRectangleConfig,
  };
})();
