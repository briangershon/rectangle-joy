(() => {
  const HISTORY_LIMIT = 10;

  function resolveHistoryApiBase() {
    if (typeof window === "undefined") return "";
    const configured = (window.HISTORY_API_BASE || "").trim();
    if (configured) {
      return configured.replace(/\/$/, "");
    }
    if (
      window.location &&
      typeof window.location.origin === "string" &&
      window.location.origin !== "null"
    ) {
      return window.location.origin.replace(/\/$/, "");
    }
    return "";
  }

  function historyApiUrl(base, path) {
    if (!path.startsWith("/")) {
      throw new Error(`History API path must start with '/': ${path}`);
    }
    if (!base) return path;
    return `${base}${path}`;
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

  function sanitizeConfig(config) {
    if (!config || typeof config !== "object") return {};
    const copy = { ...config };
    copy.colorZones = cloneColorZones(config.colorZones || []);
    return copy;
  }

  function sanitizeHistoryEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const id = typeof entry.id === "string" ? entry.id : null;
    if (!id) return null;

    const createdAtMs = entry.createdAt ? new Date(entry.createdAt).getTime() : Date.now();

    return {
      id,
      prompt: typeof entry.prompt === "string" ? entry.prompt : "",
      resultType: typeof entry.resultType === "string" ? entry.resultType : "unknown",
      createdAt: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
      config: sanitizeConfig(entry.config),
      rectangles: sanitizeRectangles(entry.rectangles),
      canvasWidth: Number(entry.canvasWidth) || 0,
      canvasHeight: Number(entry.canvasHeight) || 0,
    };
  }

  function buildHistoryPayload(prompt, resultType, renderDetails) {
    return {
      prompt: prompt || "",
      resultType: resultType || "unknown",
      config: sanitizeConfig(renderDetails.config),
      rectangles: sanitizeRectangles(renderDetails.rects),
      canvasWidth: Math.round(Number(renderDetails.canvasWidth) || 0),
      canvasHeight: Math.round(Number(renderDetails.canvasHeight) || 0),
    };
  }

  function formatHistoryTimestamp(timestamp) {
    try {
      return new Date(timestamp).toLocaleString();
    } catch (error) {
      return String(timestamp);
    }
  }

  async function fetchHistory(base) {
    const response = await fetch(historyApiUrl(base, "/api/history"), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`History request failed with status ${response.status}`);
    }

    const data = await response.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map((item) => sanitizeHistoryEntry(item)).filter(Boolean);
  }

  async function persistHistory(base, promptText, resultType, renderDetails) {
    const payload = buildHistoryPayload(promptText, resultType, renderDetails);

    const response = await fetch(historyApiUrl(base, "/api/history"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      const message = text || response.statusText || "Failed to save history.";
      throw new Error(message);
    }

    const data = await response.json();
    return sanitizeHistoryEntry(data?.item);
  }

  window.RectangleHistoryClient = {
    HISTORY_LIMIT,
    resolveHistoryApiBase,
    formatHistoryTimestamp,
    fetchHistory,
    persistHistory,
  };
})();
