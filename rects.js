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
    minSize: 20,
    maxSize: 70,
    colorZones: [], // Array of {x, y, radius, color} objects
  });

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

  // Color zone utilities
  function calculateZoneCoverage(rect, zone) {
    // Calculate what percentage of the rectangle is inside the circular zone
    const rectCenterX = rect.x + rect.w / 2;
    const rectCenterY = rect.y + rect.h / 2;

    // Use zone coordinates directly (assume they're already in CSS pixels)
    const zoneX = zone.x;
    const zoneY = zone.y;
    const zoneRadius = zone.radius;

    // Simple approximation: if rectangle center is within zone radius, consider it covered
    const distanceToZoneCenter = Math.hypot(rectCenterX - zoneX, rectCenterY - zoneY);

    if (distanceToZoneCenter <= zoneRadius) {
      // Calculate coverage based on how much of the rectangle fits within the circle
      const rectRadius = Math.hypot(rect.w / 2, rect.h / 2);
      if (distanceToZoneCenter + rectRadius <= zoneRadius) {
        return 1.0; // Fully inside
      } else {
        // Partial coverage - simplified linear interpolation
        const overlapDistance = zoneRadius - distanceToZoneCenter;
        return Math.max(0, Math.min(1, overlapDistance / rectRadius));
      }
    }

    return 0;
  }

  function getEffectiveColor(rect, zones, defaultColor) {
    // Find the zone with the highest coverage for this rectangle
    let bestZone = null;
    let bestCoverage = 0;

    for (const zone of zones) {
      const coverage = calculateZoneCoverage(rect, zone);
      if (coverage > bestCoverage) {
        bestCoverage = coverage;
        bestZone = zone;
      }
    }

    // Use zone color if coverage is > 5% (very low threshold for maximum zone visibility)
    const useZoneColor = bestCoverage > 0.05 && bestZone;

    // Debug: Log coverage for first few rectangles to understand what's happening
    if (rect.x < 100 && rect.y < 100) {
      console.log(`Debug: Rect at (${rect.x},${rect.y}) coverage: ${bestCoverage.toFixed(3)}, using zone color: ${useZoneColor}, zone:`, bestZone?.color);
    }

    return useZoneColor ? bestZone.color : defaultColor;
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
    console.log(`Debug: Generating rectangles - target: ${targetCount}, canvas: ${width}x${height}, size: ${minSize}-${maxSize}`);

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

      // Log progress every 1000 attempts
      if (attempts % 1000 === 0) {
        console.log(`Debug: Rectangle generation progress: ${rects.length}/${targetCount} placed, ${attempts} attempts`);
      }
    }

    console.log(`Debug: Rectangle generation complete: ${rects.length}/${targetCount} rectangles placed in ${attempts} attempts`);
    return rects;
  }

  function randInt(min, max) {
    // inclusive of min, inclusive of max
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function draw(rects, color, colorZones = []) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw color zones first (as semi-transparent guides)
    if (colorZones.length > 0) {
      console.log("Debug: Drawing", colorZones.length, "color zones on canvas", canvas.width, "x", canvas.height, ":", colorZones);
      ctx.globalAlpha = 0.4; // Much more visible for debugging
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

        console.log(`Debug: Zone raw values: (${zone.x},${zone.y}) radius ${zone.radius}`);
        console.log(`Debug: Canvas CSS size: ${cssCanvasWidth} x ${cssCanvasHeight}`);
        console.log(`Debug: Direct approach: (${zoneXDirect},${zoneYDirect}) radius ${zoneRadiusDirect}`);
        console.log(`Debug: Divided approach: (${zoneXDivided},${zoneYDivided}) radius ${zoneRadiusDivided}`);
        console.log(`Debug: Direct percentages: X=${(zoneXDirect/cssCanvasWidth*100).toFixed(1)}%, Y=${(zoneYDirect/cssCanvasHeight*100).toFixed(1)}%, R=${(zoneRadiusDirect/cssCanvasWidth*100).toFixed(1)}% of width`);

        // Use direct coordinates (assume AI gives CSS pixel values)
        ctx.fillStyle = zone.color;
        ctx.beginPath();
        ctx.arc(zoneXDirect, zoneYDirect, zoneRadiusDirect, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;
    }

    // Draw rectangles with zone-based coloring
    for (const r of rects) {
      const effectiveColor = getEffectiveColor(r, colorZones, color);
      ctx.fillStyle = effectiveColor;
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
      20,
      40,
      DEFAULT_CONFIG.minSize
    );
    const maxCandidate = clampNumber(
      config.maxSize,
      60,
      80,
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
      .filter(zone => zone && typeof zone === "object")
      .map(zone => ({
        x: Number(zone.x) || 0,
        y: Number(zone.y) || 0,
        radius: Math.max(1, Number(zone.radius) || 50),
        color: parseColor(zone.color)
      }))
      .filter(zone =>
        Number.isFinite(zone.x) &&
        Number.isFinite(zone.y) &&
        Number.isFinite(zone.radius)
      );
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
    console.log("Rectangle tool payload", {
      source: sourceLabel,
      config: safeConfig,
    });
    activeConfig = safeConfig;
    activeSourceLabel = sourceLabel;
    const rects = generateRectangles(
      canvas.width,
      canvas.height,
      safeConfig.count,
      safeConfig.minSize,
      safeConfig.maxSize
    );
    draw(rects, safeConfig.color, safeConfig.colorZones || []);
    updateStatus(rects.length, safeConfig.count, sourceLabel);
  }

  function runWithArtPlan(artPlan, sourceLabel = "art plan") {
    console.log("Debug: runWithArtPlan called with:", artPlan);

    if (!artPlan || !artPlan.rectangles || !artPlan.colorZones) {
      console.log("Debug: Invalid art plan structure:", { artPlan, hasRectangles: !!artPlan?.rectangles, hasColorZones: !!artPlan?.colorZones });
      throw new Error("Invalid art plan structure");
    }

    console.log("Debug: Art plan rectangles config:", artPlan.rectangles);
    console.log("Debug: Art plan color zones:", artPlan.colorZones);

    const combinedConfig = {
      ...artPlan.rectangles,
      colorZones: artPlan.colorZones,
    };

    console.log("Debug: Combined config for art plan:", combinedConfig);
    runWithConfig(combinedConfig, sourceLabel);
  }

  function setPromptBusy(isBusy) {
    if (runPromptBtn) {
      runPromptBtn.disabled = isBusy;
      runPromptBtn.textContent = isBusy
        ? "Generating..."
        : promptButtonIdleLabel || "Generate";
    }
    if (regenBtn) {
      regenBtn.disabled = isBusy;
    }
  }

  async function handlePromptRun(event) {
    if (event) event.preventDefault();
    const promptText = promptInput ? promptInput.value.trim() : "";
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

    setPromptBusy(true);
    setStatusMessage("Processing prompt...");

    try {
      // Ensure canvas is properly sized before getting dimensions
      resizeCanvasToDisplaySize();

      // Get actual canvas dimensions for AI planning
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;

      console.log("Debug: Sending canvas dimensions to AI:", canvasWidth, "x", canvasHeight);

      const result = await LLMRectangles.processPrompt(promptText, canvasWidth, canvasHeight);

      if (result.type === "rectangles") {
        runWithConfig(result.config, "AI rectangles");
      } else if (result.type === "art_plan") {
        runWithArtPlan(result.config, "AI art");
      } else {
        throw new Error("Unknown result type from AI");
      }
    } catch (error) {
      console.error(error);
      const message = normalizeErrorMessage(error);
      setStatusMessage(`AI error: ${message}`);
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

  function hasLLMSupport() {
    return (
      typeof window !== "undefined" &&
      typeof window.LLMRectangles === "object" &&
      typeof window.LLMRectangles.processPrompt === "function" &&
      typeof window.LLMRectangles.isApiKeyAvailable === "function"
    );
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
