/* Rectangle packing with a 2px minimum border-to-border gap.
   - All rectangles are axis-aligned.
   - Fully contained within canvas.
   - Borders never overlap or touch; min gap = GAP between any two borders.
   - Containment (nesting) is allowed iff the inner border is ≥ GAP away from the outer border on all sides.
   - Separated rectangles must be at least GAP apart (including diagonals).
*/

(() => {
  const GAP = 2; // pixels between any two rectangle borders
  const MAX_ATTEMPTS_PER_RECT = 500; // placement retries per rectangle before giving up on that rect

  const canvas = document.getElementById("rectCanvas");
  const ctx = canvas.getContext("2d");

  const regenBtn = document.getElementById("regen");
  const statusEl = document.getElementById("status");
  const promptInput = document.getElementById("prompt");
  const runPromptBtn = document.getElementById("runPrompt");

  const DEFAULT_CONFIG = Object.freeze({
    color: "#1f77b4",
    count: 1000,
    minSize: 8,
    maxSize: 60,
  });

  const AGENT_SYSTEM_PROMPT = [
    "You translate natural-language prompts into rectangle generation settings.",
    'Respond with valid JSON matching: { "color": string, "count": number, "minSize": number, "maxSize": number }.',
    "Rules:",
    "- color: CSS hex string (#rrggbb).",
    "- count: integer 1-5000.",
    "- minSize: integer 2-1000.",
    "- maxSize: integer 2-2000 and >= minSize.",
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
        minimum: 8,
        maximum: 16,
      },
      maxSize: {
        type: "integer",
        minimum: 60,
        maximum: 300,
      },
    },
    required: ["color", "count", "minSize", "maxSize"],
  };

  const promptButtonIdleLabel = runPromptBtn ? runPromptBtn.textContent : "";
  let activeConfig = { ...DEFAULT_CONFIG };
  let activeSourceLabel = "defaults";

  // Resize canvas to device pixels for crispness
  function resizeCanvasToDisplaySize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.floor(rect.width * dpr);
    const displayHeight = Math.floor(rect.height * dpr);

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
  }

  // Geometry helpers
  function rectContains(outer, inner) {
    return (
      inner.x >= outer.x &&
      inner.y >= outer.y &&
      inner.x + inner.w <= outer.x + outer.w &&
      inner.y + inner.h <= outer.y + outer.h
    );
  }

  function containsWithGap(outer, inner, gap) {
    return (
      inner.x - outer.x >= gap &&
      inner.y - outer.y >= gap &&
      outer.x + outer.w - (inner.x + inner.w) >= gap &&
      outer.y + outer.h - (inner.y + inner.h) >= gap
    );
  }

  function rectsIntersectStrict(a, b) {
    // True if areas overlap (not just touching edges)
    return !(
      a.x + a.w <= b.x ||
      b.x + b.w <= a.x ||
      a.y + a.h <= b.y ||
      b.y + b.h <= a.y
    );
  }

  function rectsTouchOrOverlap(a, b) {
    // True if they overlap or touch (zero gap)
    return !(
      a.x + a.w < b.x ||
      b.x + b.w < a.x ||
      a.y + a.h < b.y ||
      b.y + b.h < a.y
    );
  }

  // Minimum edge-to-edge distance (Euclidean) between two axis-aligned rectangles.
  function minEdgeDistance(a, b) {
    const dx =
      a.x > b.x + b.w
        ? a.x - (b.x + b.w)
        : b.x > a.x + a.w
        ? b.x - (a.x + a.w)
        : 0; // overlap in x -> dx=0
    const dy =
      a.y > b.y + b.h
        ? a.y - (b.y + b.h)
        : b.y > a.y + a.h
        ? b.y - (a.y + a.h)
        : 0; // overlap in y -> dy=0
    return Math.hypot(dx, dy);
  }

  // Validate a candidate rectangle against existing ones, allowing nesting with ≥ GAP margin.
  function isValidPlacement(candidate, rects, gap) {
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];

      // If they overlap in area, reject immediately.
      if (rectsIntersectStrict(candidate, r)) return false;

      const touchOrOverlap = rectsTouchOrOverlap(candidate, r);

      // If one contains the other, ensure ≥ gap margins on all sides.
      const candInR = rectContains(r, candidate);
      const rInCand = rectContains(candidate, r);

      if (candInR || rInCand) {
        const ok = candInR
          ? containsWithGap(r, candidate, gap)
          : containsWithGap(candidate, r, gap);
        if (!ok) return false;
        // If containment with margins is satisfied, it's fine regardless of diagonal distances.
        continue;
      }

      // Otherwise, they are disjoint (neither contains the other)
      // Ensure their minimum border distance ≥ gap (handles horizontal, vertical, and diagonal separation).
      const dist = minEdgeDistance(candidate, r);
      if (dist < gap) return false;

      // If they merely "touch" (dist == 0) and not contained, also reject (borders cannot overlap or touch)
      if (touchOrOverlap && dist === 0) return false;
    }
    return true;
  }

  // Try to place `targetCount` rectangles with random sizes in [minSize, maxSize].
  function generateRectangles(width, height, targetCount, minSize, maxSize) {
    const rects = [];
    let attempts = 0;

    // Safety to avoid infinite loops if space is tight.
    const MAX_TOTAL_ATTEMPTS = targetCount * MAX_ATTEMPTS_PER_RECT;

    while (rects.length < targetCount && attempts < MAX_TOTAL_ATTEMPTS) {
      attempts++;

      const w = randInt(minSize, maxSize);
      const h = randInt(minSize, maxSize);

      // Ensure fully contained within canvas with GAP margin from canvas border?
      // Requirement only says fully contained; borders can't overlap each other, not the canvas.
      // We'll allow rectangles to sit against the canvas edge (no gap required vs canvas).
      const x = randInt(0, Math.max(0, width - w));
      const y = randInt(0, Math.max(0, height - h));

      const cand = { x, y, w, h };

      if (isValidPlacement(cand, rects, GAP)) {
        rects.push(cand);
      }
    }

    return rects;
  }

  function randInt(min, max) {
    // inclusive of min, inclusive of max
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function draw(rects, color) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    for (const r of rects) {
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }

  function setStatusMessage(text) {
    statusEl.textContent = text;
  }

  function updateStatus(placed, target, sourceLabel) {
    const detail = sourceLabel ? ` - ${sourceLabel}` : "";
    setStatusMessage(`Placed ${placed} / ${target} rectangles${detail}`);
  }

  function sanitizeConfig(config) {
    if (!config || typeof config !== "object") {
      return { ...DEFAULT_CONFIG };
    }

    const color = parseColor(config.color);
    const minSize = clampNumber(
      config.minSize,
      2,
      1000,
      DEFAULT_CONFIG.minSize
    );
    const maxCandidate = clampNumber(
      config.maxSize,
      2,
      2000,
      Math.max(DEFAULT_CONFIG.maxSize, minSize)
    );
    const maxSize = Math.max(minSize, maxCandidate);
    const count = clampNumber(config.count, 1, 5000, DEFAULT_CONFIG.count);

    return { color, count, minSize, maxSize };
  }

  function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    const rounded = Math.round(num);
    if (rounded < min) return min;
    if (rounded > max) return max;
    return rounded;
  }

  function parseColor(value) {
    if (typeof value !== "string") return DEFAULT_CONFIG.color;
    const trimmed = value.trim();
    if (/^#([0-9a-f]{6})$/i.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    if (/^#([0-9a-f]{3})$/i.test(trimmed)) {
      const hex = trimmed.slice(1);
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
    }
    return DEFAULT_CONFIG.color;
  }

  function runWithConfig(config, sourceLabel = "defaults") {
    resizeCanvasToDisplaySize();
    const safeConfig = sanitizeConfig(config);
    activeConfig = safeConfig;
    activeSourceLabel = sourceLabel;
    const rects = generateRectangles(
      canvas.width,
      canvas.height,
      safeConfig.count,
      safeConfig.minSize,
      safeConfig.maxSize
    );
    draw(rects, safeConfig.color);
    updateStatus(rects.length, safeConfig.count, sourceLabel);
  }

  function setPromptBusy(isBusy) {
    if (runPromptBtn) {
      runPromptBtn.disabled = isBusy;
      runPromptBtn.textContent = isBusy
        ? "Working..."
        : promptButtonIdleLabel || "Apply Prompt";
    }
    if (regenBtn) {
      regenBtn.disabled = isBusy;
    }
  }

  async function handlePromptRun(event) {
    if (event) event.preventDefault();
    const promptText = promptInput ? promptInput.value.trim() : "";
    if (!promptText) {
      setStatusMessage("Enter a prompt to apply.");
      if (promptInput) promptInput.focus();
      return;
    }

    if (!isApiKeyAvailable()) {
      setStatusMessage("Set OPENAI_API_KEY in config.js to use the agent.");
      return;
    }

    setPromptBusy(true);
    setStatusMessage("Interpreting prompt...");

    try {
      const config = await requestRectanglesFromPrompt(promptText);
      runWithConfig(config, "prompt");
    } catch (error) {
      console.error(error);
      const message = normalizeErrorMessage(error);
      setStatusMessage(`Prompt error: ${message}`);
    } finally {
      setPromptBusy(false);
    }
  }

  function normalizeErrorMessage(error) {
    const message =
      error && typeof error.message === "string"
        ? error.message
        : "Unknown error";
    if (message === "Failed to fetch") {
      return "Network request blocked. Check your connection, CORS, or browser console.";
    }
    return message;
  }

  function isApiKeyAvailable() {
    return (
      typeof OPENAI_API_KEY === "string" && OPENAI_API_KEY.trim().length > 0
    );
  }

  async function requestRectanglesFromPrompt(userPrompt) {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "responses=v1",
      },
      body: JSON.stringify({
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
      }),
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

  function regenerate() {
    runWithConfig(DEFAULT_CONFIG, "defaults");
  }

  function redrawActiveConfig() {
    runWithConfig(activeConfig, activeSourceLabel);
  }

  // Hook up UI
  regenBtn.addEventListener("click", regenerate);
  if (runPromptBtn) {
    runPromptBtn.addEventListener("click", handlePromptRun);
  }
  if (promptInput) {
    promptInput.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        handlePromptRun(event);
      }
    });
  }
  window.addEventListener("resize", redrawActiveConfig);

  // Initial draw
  regenerate();
})();
