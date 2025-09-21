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

  // Create a hidden 2D canvas for rectangle rendering
  const sourceCanvas = document.createElement("canvas");
  const sourceCtx = sourceCanvas.getContext("2d");

  // Initialize shader system - will use WebGL on main canvas
  let frameGlassShader = null;
  let ctx = null; // Will be set based on whether WebGL is available

  const statusEl = document.getElementById("status");
  const promptInput = document.getElementById("prompt");
  const historyListEl = document.getElementById("historyList");

  const historyClient = window.RectangleHistoryClient || null;
  const HISTORY_LIMIT = historyClient?.HISTORY_LIMIT || 10;

  let artHistory = [];
  let historyEndpointBase = "";
  let historyLoading = false;
  let historyLoadError = null;
  let historyEnabled = !!historyClient;

  const DEFAULT_CONFIG = Object.freeze({
    color: "#1f77b4",
    count: 1000,
    minSize: 5,
    maxSize: 50,
    colorZones: [], // Array of {x, y, radius, color} objects
  });

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

      // Also resize the source canvas
      sourceCanvas.width = displayWidth;
      sourceCanvas.height = displayHeight;
      sourceCtx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels

      // Resize shader system if it exists
      if (frameGlassShader) {
        frameGlassShader.resize(displayWidth, displayHeight);
      }
    }
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
    }
  }

  // Initialize shader system
  function initShaderSystem() {
    try {
      if (typeof window.FrameGlassShader !== 'undefined') {
        frameGlassShader = new window.FrameGlassShader(canvas);
        console.log('Frame and glass shader system initialized successfully');

        // Set some nice default values for the effects
        frameGlassShader.setFrameWidth(0.08); // 8% frame width
        frameGlassShader.setGlassIntensity(0.8); // Subtle glass effect
        frameGlassShader.setReflectionIntensity(0.6); // Subtle reflective frame
      } else {
        console.warn('FrameGlassShader not available - falling back to standard rendering');
        ctx = canvas.getContext("2d");
      }
    } catch (error) {
      console.warn('Failed to initialize shader system:', error.message);
      console.warn('Falling back to standard 2D rendering');
      frameGlassShader = null;
      ctx = canvas.getContext("2d");
    }
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

  function sanitizeRectangles(rectangles) {
    if (!Array.isArray(rectangles)) return [];
    const cleaned = [];
    for (const rect of rectangles) {
      if (!rect || typeof rect !== "object") continue;
      const x = Number(rect.x);
      const y = Number(rect.y);
      const w = Number(rect.w);
      const h = Number(rect.h);
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(w) ||
        !Number.isFinite(h)
      ) {
        continue;
      }
      cleaned.push({ x, y, w, h });
    }
    return cleaned;
  }

  function cloneColorZones(zones) {
    if (!Array.isArray(zones)) return [];
    return zones
      .map((zone) => {
        if (!zone || typeof zone !== "object") return null;
        return { ...zone };
      })
      .filter(Boolean);
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

  // Color zone utilities

  function getEffectiveColor(rect, zones, defaultColor) {
    // Simple center-point check: if rectangle center is inside any zone, use that zone's color
    const rectCenterX = rect.x + rect.w / 2;
    const rectCenterY = rect.y + rect.h / 2;

    for (const zone of zones) {
      if (zone.type === "circle") {
        const distanceToZoneCenter = Math.hypot(
          rectCenterX - zone.x,
          rectCenterY - zone.y
        );
        if (distanceToZoneCenter <= zone.radius) {
          return zone.color; // First matching zone wins
        }
      } else if (zone.type === "rectangle") {
        // Check if rectangle center is inside the rectangular zone
        if (
          rectCenterX >= zone.x &&
          rectCenterX <= zone.x + zone.width &&
          rectCenterY >= zone.y &&
          rectCenterY <= zone.y + zone.height
        ) {
          return zone.color; // First matching zone wins
        }
      }
    }

    return defaultColor; // Not in any zone
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
    console.log(
      `Debug: Generating rectangles - target: ${targetCount}, canvas: ${width}x${height}, size: ${minSize}-${maxSize}`
    );

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

    console.log(
      `Debug: Rectangle generation complete: ${rects.length}/${targetCount} rectangles placed in ${attempts} attempts`
    );
    return rects;
  }

  function randInt(min, max) {
    // inclusive of min, inclusive of max
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function draw(rects, color, colorZones = []) {
    // Clear both canvases
    sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // Draw to source canvas first
    // Draw color zones first (as semi-transparent guides)
    if (colorZones.length > 0) {
      console.log(
        "Debug: Drawing",
        colorZones.length,
        "color zones on canvas",
        canvas.width,
        "x",
        canvas.height,
        ":",
        colorZones
      );
      sourceCtx.globalAlpha = 0.4; // Much more visible for debugging
      for (const zone of colorZones) {
        // Test: Use zone coordinates directly (assuming they're already in CSS pixels)
        const dpr = window.devicePixelRatio || 1;
        const cssCanvasWidth = canvas.width / dpr;
        const cssCanvasHeight = canvas.height / dpr;

        // Try both approaches to see which works
        const zoneXDirect = zone.x;
        const zoneYDirect = zone.y;
        const zoneRadiusDirect = zone.radius;

        const zoneXDivided = zone.x / dpr;
        const zoneYDivided = zone.y / dpr;
        const zoneRadiusDivided = zone.radius / dpr;

        console.log(
          `Debug: Zone raw values: (${zone.x},${zone.y}) radius ${zone.radius}`
        );
        console.log(
          `Debug: Canvas CSS size: ${cssCanvasWidth} x ${cssCanvasHeight}`
        );
        console.log(
          `Debug: Direct approach: (${zoneXDirect},${zoneYDirect}) radius ${zoneRadiusDirect}`
        );
        console.log(
          `Debug: Divided approach: (${zoneXDivided},${zoneYDivided}) radius ${zoneRadiusDivided}`
        );
        console.log(
          `Debug: Direct percentages: X=${(
            (zoneXDirect / cssCanvasWidth) *
            100
          ).toFixed(1)}%, Y=${((zoneYDirect / cssCanvasHeight) * 100).toFixed(
            1
          )}%, R=${((zoneRadiusDirect / cssCanvasWidth) * 100).toFixed(
            1
          )}% of width`
        );

        // Use direct coordinates (assume AI gives CSS pixel values)
        sourceCtx.fillStyle = zone.color;

        if (zone.type === "circle") {
          sourceCtx.beginPath();
          sourceCtx.arc(zoneXDirect, zoneYDirect, zoneRadiusDirect, 0, 2 * Math.PI);
          sourceCtx.fill();
        } else if (zone.type === "rectangle") {
          sourceCtx.fillRect(zone.x, zone.y, zone.width, zone.height);
        }
      }
      sourceCtx.globalAlpha = 1.0;
    }

    // Draw rectangles with zone-based coloring to source canvas
    for (const r of rects) {
      const effectiveColor = getEffectiveColor(r, colorZones, color);
      sourceCtx.fillStyle = effectiveColor;
      sourceCtx.fillRect(r.x, r.y, r.w, r.h);
    }

    // Apply shader effects if available, otherwise copy directly
    if (frameGlassShader) {
      frameGlassShader.render(sourceCanvas);
    } else if (ctx) {
      // Fallback: draw source canvas directly to display canvas
      ctx.drawImage(sourceCanvas, 0, 0);
    }
  }

  function setStatusMessage(text) {
    statusEl.textContent = text;
  }


  function sanitizeConfig(config) {
    if (!config || typeof config !== "object") {
      return { ...DEFAULT_CONFIG };
    }

    const color = parseColor(config.color);
    const minSize = clampNumber(config.minSize, 5, 30, DEFAULT_CONFIG.minSize);
    const maxCandidate = clampNumber(
      config.maxSize,
      10,
      50,
      Math.max(DEFAULT_CONFIG.maxSize, minSize)
    );
    const maxSize = Math.max(minSize, maxCandidate);
    const count = clampNumber(config.count, 500, 5000, DEFAULT_CONFIG.count);
    const colorZones = sanitizeColorZones(config.colorZones);

    return { color, count, minSize, maxSize, colorZones };
  }

  function sanitizeColorZones(zones) {
    if (!Array.isArray(zones)) {
      return [];
    }

    return zones
      .filter((zone) => zone && typeof zone === "object")
      .map((zone) => {
        const baseZone = {
          type: zone.type || "circle", // Default to circle for backward compatibility
          x: Number(zone.x) || 0,
          y: Number(zone.y) || 0,
          color: parseColor(zone.color),
        };

        if (baseZone.type === "circle") {
          return {
            ...baseZone,
            radius: Math.max(1, Number(zone.radius) || 50),
          };
        } else if (baseZone.type === "rectangle") {
          return {
            ...baseZone,
            width: Math.max(1, Number(zone.width) || 100),
            height: Math.max(1, Number(zone.height) || 100),
          };
        }

        // Invalid type, default to circle
        return {
          ...baseZone,
          type: "circle",
          radius: Math.max(1, Number(zone.radius) || 50),
        };
      })
      .filter((zone) => {
        const baseValid = Number.isFinite(zone.x) && Number.isFinite(zone.y);
        if (zone.type === "circle") {
          return baseValid && Number.isFinite(zone.radius);
        } else if (zone.type === "rectangle") {
          return baseValid && Number.isFinite(zone.width) && Number.isFinite(zone.height);
        }
        return false;
      });
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

  function runWithConfig(config, sourceLabel = "defaults", options = {}) {
    resizeCanvasToDisplaySize();
    const safeConfig = sanitizeConfig(config);
    console.log("Rectangle tool payload", {
      source: sourceLabel,
      config: safeConfig,
    });
    activeConfig = safeConfig;
    activeSourceLabel = sourceLabel;

    // Calculate CSS pixel dimensions for rectangle generation
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.width / dpr;
    const cssHeight = canvas.height / dpr;

    // Show placing rectangles message
    setStatusMessage("Placing rectangles...");

    const hasProvidedRectangles = Array.isArray(options.rectangles);
    const providedRectangles = hasProvidedRectangles
      ? sanitizeRectangles(options.rectangles)
      : null;

    const rects = hasProvidedRectangles
      ? providedRectangles
      : generateRectangles(
          cssWidth,
          cssHeight,
          safeConfig.count,
          safeConfig.minSize,
          safeConfig.maxSize
        );

    draw(rects, safeConfig.color, safeConfig.colorZones || []);

    const statusMessage = hasProvidedRectangles
      ? `Loaded saved art with ${rects.length} rectangles`
      : `Placed ${rects.length}/${safeConfig.count} rectangles`;
    setStatusMessage(statusMessage);

    const renderDetails = {
      rects: sanitizeRectangles(rects),
      config: {
        ...safeConfig,
        colorZones: cloneColorZones(safeConfig.colorZones),
      },
      canvasWidth: cssWidth,
      canvasHeight: cssHeight,
      source: sourceLabel,
    };

    if (typeof options.onRendered === "function") {
      try {
        options.onRendered(renderDetails);
      } catch (callbackError) {
        console.warn("History callback failed", callbackError);
      }
    }

    return renderDetails;
  }

  function runWithArtPlan(artPlan, sourceLabel = "art plan") {
    console.log("Debug: runWithArtPlan called with:", artPlan);

    if (!artPlan || !artPlan.rectangles || !artPlan.colorZones) {
      console.log("Debug: Invalid art plan structure:", {
        artPlan,
        hasRectangles: !!artPlan?.rectangles,
        hasColorZones: !!artPlan?.colorZones,
      });
      throw new Error("Invalid art plan structure");
    }

    // Log the art plan execution
    console.log(`🎯 Executing art plan with ${artPlan.colorZones?.length || 0} color zones`);

    console.log("Debug: Art plan rectangles config:", artPlan.rectangles);
    console.log("Debug: Art plan color zones:", artPlan.colorZones);

    const combinedConfig = {
      ...artPlan.rectangles,
      colorZones: artPlan.colorZones,
    };

    console.log("Debug: Combined config for art plan:", combinedConfig);
    return runWithConfig(combinedConfig, sourceLabel);
  }


  async function handlePromptRun(event) {
    if (event) event.preventDefault();
    const promptText = promptInput ? promptInput.textContent.trim() : "";
    if (!promptText) {
      setStatusMessage("Enter a prompt to generate.");
      if (promptInput) promptInput.focus();
      return;
    }

    if (!hasLLMSupport()) {
      setStatusMessage("LLM module unavailable. Check llm.js load order.");
      return;
    }

    if (!LLMRectangles.isApiKeyAvailable()) {
      setStatusMessage("Set OPENAI_API_KEY in config.js to use the agent.");
      return;
    }

    setStatusMessage("Generating concept...");

    try {
      // Ensure canvas is properly sized before getting dimensions
      resizeCanvasToDisplaySize();

      // Get CSS canvas dimensions for AI planning
      const dpr = window.devicePixelRatio || 1;
      const canvasWidth = canvas.width / dpr;
      const canvasHeight = canvas.height / dpr;

      console.log(
        "Debug: Sending canvas dimensions to AI:",
        canvasWidth,
        "x",
        canvasHeight
      );

      const result = await LLMRectangles.processPrompt(
        promptText,
        canvasWidth,
        canvasHeight
      );

      setStatusMessage("Generating artwork...");

      let renderOutcome = null;
      if (result.type === "rectangles") {
        renderOutcome = runWithConfig(result.config, "rectangles");
      } else if (result.type === "art_plan") {
        renderOutcome = runWithArtPlan(result.config, "art plan");
      } else {
        throw new Error("Unknown result type from AI");
      }

      if (renderOutcome) {
        await persistPromptResult(promptText, result.type, renderOutcome);
      }
    } catch (error) {
      console.error(error);
      const message = normalizeErrorMessage(error);
      setStatusMessage(`Error: ${message}`);
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

  function hasLLMSupport() {
    return (
      typeof window !== "undefined" &&
      typeof window.LLMRectangles === "object" &&
      typeof window.LLMRectangles.processPrompt === "function" &&
      typeof window.LLMRectangles.isApiKeyAvailable === "function"
    );
  }


  function redrawActiveConfig() {
    runWithConfig(activeConfig, activeSourceLabel);
  }

  // Mouse tracking for interactive reflections
  let lastMouseUpdate = 0;
  const MOUSE_UPDATE_THROTTLE = 16; // ~60fps

  function handleMouseMove(event) {
    if (!frameGlassShader) return;

    const now = Date.now();
    if (now - lastMouseUpdate < MOUSE_UPDATE_THROTTLE) return;
    lastMouseUpdate = now;

    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    frameGlassShader.setMousePosition(x, y);

    // Re-render with new mouse position
    if (frameGlassShader) {
      frameGlassShader.render(sourceCanvas);
    }
  }

  function handleMouseLeave() {
    if (!frameGlassShader) return;

    // Return to center position when mouse leaves
    frameGlassShader.setMousePosition(0.5, 0.5);

    // Re-render with center position
    if (frameGlassShader) {
      frameGlassShader.render(sourceCanvas);
    }
  }

  // Hook up UI
  if (promptInput) {
    promptInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handlePromptRun(event);
      }
    });
  }

  // Add mouse tracking for interactive reflections
  canvas.addEventListener("mousemove", handleMouseMove);
  canvas.addEventListener("mouseleave", handleMouseLeave);

  window.addEventListener("resize", redrawActiveConfig);

  // Initialize shader system after DOM is ready
  initShaderSystem();

  function formatHistoryTimestamp(timestamp) {
    if (historyClient && typeof historyClient.formatHistoryTimestamp === "function") {
      return historyClient.formatHistoryTimestamp(timestamp);
    }
    try {
      return new Date(timestamp).toLocaleString();
    } catch (error) {
      return String(timestamp);
    }
  }

  function updateHistoryUI() {
    if (!historyListEl) return;
    historyListEl.innerHTML = "";

    if (!historyEnabled) {
      const disabledItem = document.createElement("li");
      disabledItem.className = "history-empty";
      disabledItem.textContent = "History server not configured.";
      historyListEl.appendChild(disabledItem);
      return;
    }

    let message = "";

    if (historyLoading) {
      message = "Loading history...";
    } else if (historyLoadError) {
      message = historyLoadError;
    } else if (!artHistory.length) {
      message = "No saved art yet.";
    }

    if (message) {
      const emptyItem = document.createElement("li");
      emptyItem.className = "history-empty";
      emptyItem.textContent = message;
      historyListEl.appendChild(emptyItem);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const entry of artHistory) {
      const item = document.createElement("li");
      item.className = "history-item";

      const label = document.createElement("span");
      label.textContent = `${entry.prompt || "(untitled)"} • ${
        formatHistoryTimestamp(entry.createdAt)
      }`;

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "View";
      button.addEventListener("click", () => {
        loadHistoryEntry(entry.id);
      });

      item.appendChild(label);
      item.appendChild(button);
      fragment.appendChild(item);
    }

    historyListEl.appendChild(fragment);
  }

  function loadHistoryEntry(entryId) {
    const entry = artHistory.find((item) => item.id === entryId);
    if (!entry) return;

    if (promptInput) {
      promptInput.textContent = entry.prompt;
    }

    runWithConfig(entry.config, "history", {
      rectangles: entry.rectangles,
    });

    setStatusMessage(`Loaded saved art from prompt: "${entry.prompt}"`);
  }

  async function persistPromptResult(promptText, resultType, renderDetails) {
    if (!historyEnabled) return;
    if (!renderDetails || !Array.isArray(renderDetails.rects)) return;

    try {
      const savedEntry = await historyClient.persistHistory(
        historyEndpointBase,
        promptText,
        resultType,
        renderDetails
      );
      if (!savedEntry) return;

      historyLoadError = null;
      artHistory.unshift(savedEntry);
      if (artHistory.length > HISTORY_LIMIT) {
        artHistory = artHistory.slice(0, HISTORY_LIMIT);
      }
      updateHistoryUI();
    } catch (error) {
      console.warn("Failed to save history", error);
      historyLoadError = "Unable to save history right now.";
      updateHistoryUI();
    }
  }

  async function initializeHistory() {
    historyEndpointBase = historyClient.resolveHistoryApiBase();

    if (
      !historyEndpointBase &&
      (typeof window === "undefined" || !window.location || window.location.origin === "null")
    ) {
      historyEnabled = false;
      historyLoading = false;
      historyLoadError = null;
      updateHistoryUI();
      return;
    }

    historyEnabled = true;
    historyLoading = true;
    historyLoadError = null;
    updateHistoryUI();

    try {
      const items = await historyClient.fetchHistory(historyEndpointBase);
      artHistory = items;
      historyLoadError = null;
    } catch (error) {
      console.warn("Failed to fetch history", error);
      historyLoadError =
        error && typeof error.message === "string" ? error.message : "Failed to load history.";
    } finally {
      historyLoading = false;
      updateHistoryUI();
    }
  }

  initializeHistory();

  // Initial draw
  runWithConfig(DEFAULT_CONFIG, "defaults");
})();
