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

  const DEFAULT_COLOR = "#1f77b4";
  const DEFAULT_TARGET_COUNT = 1000;
  const DEFAULT_MIN_SIZE = 8;
  const DEFAULT_MAX_SIZE = 60;

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

  function updateStatus(placed, target) {
    statusEl.textContent = `Placed ${placed} / ${target} rectangles`;
  }

  function regenerate() {
    resizeCanvasToDisplaySize();

    const rects = generateRectangles(
      canvas.width,
      canvas.height,
      DEFAULT_TARGET_COUNT,
      DEFAULT_MIN_SIZE,
      DEFAULT_MAX_SIZE
    );
    draw(rects, DEFAULT_COLOR);
    updateStatus(rects.length, DEFAULT_TARGET_COUNT);
  }

  // Hook up UI
  regenBtn.addEventListener("click", regenerate);
  window.addEventListener("resize", regenerate);

  // Initial draw
  regenerate();
})();
