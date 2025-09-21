(() => {
  const AGENT_SYSTEM_PROMPT = [
    "You translate natural-language prompts into rectangle generation settings.",
    'Respond with valid JSON matching: { "color": string, "count": number, "minSize": number, "maxSize": number }.',
    "Rules:",
    "- color: CSS hex string (#rrggbb).",
    "- count: integer 500-5000.",
    "- minSize: integer 5-30.",
    "- maxSize: integer 10-50 and >= minSize.",
    "Omitted values should fall back to sensible defaults within range.",
  ].join(" ");

  const ART_PLANNER_SYSTEM_PROMPT = [
    "You are a Simple Concept-to-Art Planner. Translate user prompts into basic geometric shapes using color zones.",
    'Respond with valid JSON matching: { "colorZones": [{"x": number, "y": number, "radius": number, "color": string}], "rectangles": {"color": string, "count": number, "minSize": number, "maxSize": number} }.',
    "Process:",
    "1. Identify the core concept in the prompt",
    "2. Map it to simple geometric shapes with sufficient color zones for clarity",
    "3. Create multiple overlapping zones to ensure the shape is clearly visible",
    "Rules:",
    "- colorZones: Array of circular zones. x,y coordinates in pixels (0 to canvas size), radius in pixels.",
    "- rectangles.color: Default CSS hex string for background rectangles.",
    "- rectangles.count: integer 1000-5000.",
    "- rectangles.minSize: integer 10-30, rectangles.maxSize: integer 20-50.",
    "- Use 12-16 zones per concept for clear definition.",
    "- Zone radii should be 15-30% of canvas width for visibility.",
    "- Use overlapping zones where needed for complex shapes.",
    "Concept Mappings:",
    "- 'forest/tree': Brown trunk zone at (50%W,75%H) radius=8%W + 3-4 overlapping green leaf zones at (50%W,35%H) radius=25%W",
    "- 'happy face/smile': 2 black eye zones at (35%W,40%H) and (65%W,40%H) radius=8%W + 1 red smile zone at (50%W,65%H) radius=15%W",
    "- 'sad face': 2 black eye zones at (35%W,40%H) and (65%W,40%H) radius=8%W + 1 blue frown zone at (50%W,70%H) radius=12%W",
    "- 'sun': 1 large yellow central zone at (50%W,50%H) radius=25%W + 6 smaller yellow ray zones around perimeter radius=8%W",
    "- 'house': Brown base zone at (50%W,65%H) radius=20%W + red roof zone at (50%W,35%H) radius=18%W + yellow window zones",
    "- 'car': Blue body zone at (50%W,55%H) radius=25%W + 2 black wheel zones at (30%W,75%H) and (70%W,75%H) radius=8%W",
    "- Use contrasting colors against light yellow background: black (#000000), red (#ff0000), blue (#0000ff), green (#00ff00), brown (#8B4513).",
    "- CANVAS_SIZE_PLACEHOLDER",
  ].join(" ");

  const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

  // Tool definitions for multi-agent system (Responses API format)
  const RECTANGLE_TOOL = {
    type: "function",
    name: "render_rectangles",
    description:
      "Generate basic rectangles with specified color, count, and size parameters",
    parameters: {
      type: "object",
      properties: {
        color: {
          type: "string",
          pattern: "^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$",
          description: "CSS hex color string (#rrggbb)",
        },
        count: {
          type: "integer",
          minimum: 500,
          maximum: 5000,
          description: "Number of rectangles to generate",
        },
        minSize: {
          type: "integer",
          minimum: 5,
          maximum: 30,
          description: "Minimum rectangle size in pixels",
        },
        maxSize: {
          type: "integer",
          minimum: 10,
          maximum: 50,
          description: "Maximum rectangle size in pixels",
        },
      },
      required: ["color", "count", "minSize", "maxSize"],
      additionalProperties: false,
    },
  };

  const ART_PLANNER_TOOL = {
    type: "function",
    name: "create_art_plan",
    description:
      "Create artistic layouts with color zones and strategic rectangle placement for recognizable patterns, shapes, or artwork",
    parameters: {
      type: "object",
      properties: {
        colorZones: {
          type: "array",
          items: {
            type: "object",
            properties: {
              x: {
                type: "number",
                minimum: 0,
                maximum: 6000,
                description: "X coordinate in pixels",
              },
              y: {
                type: "number",
                minimum: 0,
                maximum: 6000,
                description: "Y coordinate in pixels",
              },
              radius: {
                type: "number",
                minimum: 50,
                maximum: 3000,
                description:
                  "Zone radius in pixels - scale proportionally to canvas size, use 15-30% of canvas width for visibility",
              },
              color: {
                type: "string",
                pattern: "^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$",
                description: "CSS hex color for this zone",
              },
            },
            required: ["x", "y", "radius", "color"],
            additionalProperties: false,
          },
          description:
            "Array of circular color zones for creating patterns (use 4-8 zones for clear definition)",
        },
        rectangles: {
          type: "object",
          properties: {
            color: {
              type: "string",
              pattern: "^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$",
              description: "Default color for rectangles outside zones",
            },
            count: {
              type: "integer",
              minimum: 1000,
              maximum: 5000,
              description: "Number of rectangles to generate",
            },
            minSize: {
              type: "integer",
              minimum: 10,
              maximum: 30,
              description: "Minimum rectangle size (smaller for detailed art)",
            },
            maxSize: {
              type: "integer",
              minimum: 20,
              maximum: 50,
              description: "Maximum rectangle size",
            },
          },
          required: ["color", "count", "minSize", "maxSize"],
          additionalProperties: false,
        },
      },
      required: ["colorZones", "rectangles"],
      additionalProperties: false,
    },
  };

  const ROUTER_SYSTEM_PROMPT = [
    "You are a Rectangle Art Generator that creates visual art using rectangles.",
    "Analyze user prompts and decide which tool(s) to call:",
    "",
    "1. For SIMPLE requests (basic colors, counts, sizes): use render_rectangles",
    "   - Examples: 'blue rectangles', '2000 small green squares', 'red rectangles size 30-50'",
    "",
    "2. For ARTISTIC/COMPLEX requests (patterns, shapes, art): use create_art_plan",
    "   - Examples: 'happy face', 'traffic light', 'sunset', 'abstract art', 'logo', 'flower'",
    "",
    "3. You can also chain tools if needed (though usually one tool is sufficient)",
    "",
    "Always call at least one tool. Choose the most appropriate tool based on the user's intent.",
  ].join("\n");

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
        minimum: 5,
        maximum: 30,
      },
      maxSize: {
        type: "integer",
        minimum: 10,
        maximum: 50,
      },
    },
    required: ["color", "count", "minSize", "maxSize"],
  };

  const ART_PLAN_JSON_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
      colorZones: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            x: {
              type: "number",
              minimum: 0,
              maximum: 2000,
            },
            y: {
              type: "number",
              minimum: 0,
              maximum: 2000,
            },
            radius: {
              type: "number",
              minimum: 20,
              maximum: 1500,
              description:
                "Zone radius in pixels - scale proportionally to canvas size",
            },
            color: {
              type: "string",
              pattern: "^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$",
            },
          },
          required: ["x", "y", "radius", "color"],
        },
      },
      rectangles: {
        type: "object",
        additionalProperties: false,
        properties: {
          color: {
            type: "string",
            pattern: "^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$",
          },
          count: {
            type: "integer",
            minimum: 1000,
            maximum: 5000,
          },
          minSize: {
            type: "integer",
            minimum: 10,
            maximum: 30,
          },
          maxSize: {
            type: "integer",
            minimum: 20,
            maximum: 50,
          },
        },
        required: ["color", "count", "minSize", "maxSize"],
      },
    },
    required: ["colorZones", "rectangles"],
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

  async function requestArtPlan(userPrompt) {
    if (!isApiKeyAvailable()) {
      throw new Error("Missing OpenAI API key.");
    }

    const payload = {
      model: "gpt-4o-mini",
      temperature: 0.3,
      input: [
        { role: "system", content: ART_PLANNER_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "art_plan",
          schema: ART_PLAN_JSON_SCHEMA,
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

  // Main multi-agent router function
  async function processPrompt(userPrompt, canvasWidth, canvasHeight) {
    console.log(
      "Debug: Starting processPrompt with:",
      userPrompt,
      "Canvas:",
      canvasWidth,
      "x",
      canvasHeight
    );

    if (!isApiKeyAvailable()) {
      console.log("Debug: API key not available");
      throw new Error("Missing OpenAI API key.");
    }

    console.log("Debug: API key available, preparing payload");

    // Create dynamic system prompt with actual canvas dimensions
    const canvasInfo = `Canvas is ${canvasWidth}x${canvasHeight} pixels. Use emoji as visual guide: calculate zone positions as percentages of canvas size. For eyes, use radius = 40-45% of canvas width (${Math.round(
      canvasWidth * 0.4
    )}-${Math.round(
      canvasWidth * 0.45
    )}px). Scale all emoji features proportionally to canvas size.`;

    // Create combined system prompt that includes both router and art planner instructions
    const dynamicArtPlannerSystemPrompt = ART_PLANNER_SYSTEM_PROMPT.replace(
      "CANVAS_SIZE_PLACEHOLDER",
      canvasInfo
    );

    const combinedSystemPrompt =
      ROUTER_SYSTEM_PROMPT +
      "\n\nWhen using create_art_plan tool:\n" +
      dynamicArtPlannerSystemPrompt;

    console.log("Debug: Canvas info for AI:", canvasInfo);

    // Create dynamic art planner tool with canvas dimensions
    const dynamicArtPlannerTool = {
      ...ART_PLANNER_TOOL,
      description: `Create artistic layouts with color zones and strategic rectangle placement for recognizable patterns, shapes, or artwork. Canvas is ${canvasWidth}x${canvasHeight} pixels. All coordinates and radii must be within these bounds.`,
      parameters: {
        ...ART_PLANNER_TOOL.parameters,
        properties: {
          ...ART_PLANNER_TOOL.parameters.properties,
          colorZones: {
            ...ART_PLANNER_TOOL.parameters.properties.colorZones,
            items: {
              ...ART_PLANNER_TOOL.parameters.properties.colorZones.items,
              properties: {
                ...ART_PLANNER_TOOL.parameters.properties.colorZones.items
                  .properties,
                x: {
                  ...ART_PLANNER_TOOL.parameters.properties.colorZones.items
                    .properties.x,
                  maximum: canvasWidth,
                  description: `X coordinate in pixels (0 to ${canvasWidth})`,
                },
                y: {
                  ...ART_PLANNER_TOOL.parameters.properties.colorZones.items
                    .properties.y,
                  maximum: canvasHeight,
                  description: `Y coordinate in pixels (0 to ${canvasHeight})`,
                },
                radius: {
                  ...ART_PLANNER_TOOL.parameters.properties.colorZones.items
                    .properties.radius,
                  maximum: Math.min(canvasWidth, canvasHeight),
                  description: `Zone radius in pixels (max ${Math.min(
                    canvasWidth,
                    canvasHeight
                  )} for this canvas)`,
                },
              },
            },
          },
        },
      },
    };

    const payload = {
      model: "gpt-4o-mini",
      temperature: 0.2,
      input: [
        { role: "system", content: combinedSystemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [RECTANGLE_TOOL, dynamicArtPlannerTool],
    };

    console.log("Debug: Request payload:", JSON.stringify(payload, null, 2));

    let response;
    try {
      console.log("Debug: Making request to", OPENAI_RESPONSES_URL);
      response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${window.OPENAI_API_KEY}`,
          "OpenAI-Beta": "responses=v1",
        },
        body: JSON.stringify(payload),
      });

      console.log(
        "Debug: Response received, status:",
        response.status,
        response.statusText
      );
    } catch (fetchError) {
      console.log("Debug: Fetch error:", fetchError);
      throw new Error(`Network error: ${fetchError.message}`);
    }

    const rawBody = await response.text();
    console.log("Debug: Raw response body:", rawBody);
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

    // Debug: Log the full response to understand the structure
    console.log("Full API Response:", JSON.stringify(data, null, 2));

    return processToolCalls(data);
  }

  function processToolCalls(data) {
    // Extract tool calls from the response
    const toolCalls = extractToolCalls(data);
    if (!toolCalls || toolCalls.length === 0) {
      throw new Error("No tool calls found in response.");
    }

    // Process the tool calls - for now, return the first valid one
    // In the future, you could chain multiple tool calls
    for (const toolCall of toolCalls) {
      // Handle both Chat Completions format (toolCall.function.name) and Responses API format (toolCall.name)
      const toolName = toolCall.function?.name || toolCall.name;
      const toolArgs = toolCall.function?.arguments || toolCall.arguments;

      console.log("Debug: Processing tool call:", toolName);
      console.log("Debug: Raw arguments:", toolArgs);
      console.log("Debug: Arguments type:", typeof toolArgs);

      if (toolName === "render_rectangles") {
        let config;
        try {
          config =
            typeof toolArgs === "string" ? JSON.parse(toolArgs) : toolArgs;
        } catch (parseError) {
          console.log(
            "Debug: JSON parse error for render_rectangles:",
            parseError
          );
          console.log("Debug: Truncated arguments string:", toolArgs);
          throw new Error(
            `Failed to parse render_rectangles arguments: ${parseError.message}`
          );
        }
        return {
          type: "rectangles",
          config: config,
        };
      } else if (toolName === "create_art_plan") {
        let config;
        try {
          config =
            typeof toolArgs === "string" ? JSON.parse(toolArgs) : toolArgs;
        } catch (parseError) {
          console.log(
            "Debug: JSON parse error for create_art_plan:",
            parseError
          );
          console.log("Debug: Truncated arguments string:", toolArgs);

          // Try to reconstruct the JSON if it's truncated
          if (typeof toolArgs === "string" && !toolArgs.endsWith("}")) {
            console.log("Debug: Attempting to fix truncated JSON");
            // For now, throw an error with more details
            throw new Error(
              `Truncated JSON arguments detected. Length: ${toolArgs.length}. Content: ${toolArgs}`
            );
          }

          throw new Error(
            `Failed to parse create_art_plan arguments: ${parseError.message}`
          );
        }

        // Log that art plan was created
        console.log(
          `🎨 Art Planner created concept art with ${
            config.colorZones?.length || 0
          } color zones`
        );

        return {
          type: "art_plan",
          config: config,
        };
      }
    }

    throw new Error("No valid tool calls found.");
  }

  function extractToolCalls(data) {
    if (!data || typeof data !== "object") {
      console.log("Debug: No data or data is not an object");
      return [];
    }

    console.log("Debug: Searching for tool calls in response...");

    // Handle the Response API format
    if (Array.isArray(data.output)) {
      console.log(
        "Debug: Found data.output array with",
        data.output.length,
        "items"
      );
      const functionCalls = [];

      for (const item of data.output) {
        console.log("Debug: Processing output item:", item?.type, item);
        console.log(
          "Debug: Type check:",
          item?.type === "function_call",
          "Name check:",
          !!item.name
        );

        // Responses API uses "function_call" type directly in output array
        if (item?.type === "function_call" && item.name) {
          console.log("Debug: Found function_call:", item);
          functionCalls.push(item);
        } else if (item?.type === "function_call") {
          console.log("Debug: Found function_call without name:", item);
          console.log("Debug: item.name value:", item.name, typeof item.name);
          console.log("Debug: All item properties:", Object.keys(item));
        }

        // Legacy: check for message format (keeping for backwards compatibility)
        if (item?.type === "message" && Array.isArray(item.content)) {
          console.log(
            "Debug: Found message with",
            item.content.length,
            "content parts"
          );
          for (const part of item.content) {
            console.log("Debug: Processing content part:", part?.type, part);
            if (part?.type === "tool_use" && part.tool_calls) {
              console.log(
                "Debug: Found tool_use with tool_calls:",
                part.tool_calls
              );
              return part.tool_calls;
            }
            // Also check if the part itself is a tool call
            if (part?.type === "tool_use" && (part.name || part.function)) {
              console.log("Debug: Found individual tool_use:", part);
              functionCalls.push(part);
            }
          }
        }
      }

      if (functionCalls.length > 0) {
        console.log(
          "Debug: Returning",
          functionCalls.length,
          "function calls:",
          functionCalls
        );
        return functionCalls;
      }
    }

    // Fallback: check for direct tool_calls property
    if (Array.isArray(data.tool_calls)) {
      console.log("Debug: Found direct tool_calls array:", data.tool_calls);
      return data.tool_calls;
    }

    // Check for choices format (standard completion format)
    if (Array.isArray(data.choices) && data.choices[0]?.message?.tool_calls) {
      console.log(
        "Debug: Found tool_calls in choices format:",
        data.choices[0].message.tool_calls
      );
      return data.choices[0].message.tool_calls;
    }

    console.log("Debug: No tool calls found in response");
    return [];
  }

  window.LLMRectangles = {
    isApiKeyAvailable,
    requestRectangleConfig,
    requestArtPlan,
    processPrompt,
  };
})();
