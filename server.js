const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const dotenv = require("dotenv");

dotenv.config();

const PORT = Number(process.env.PORT) || 8787;
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT) || 10;

if (!process.env.DATABASE_URL) {
  console.warn(
    "Warning: DATABASE_URL is not set. The server will start, but database routes will fail until it is provided."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

async function ensureSchema() {
  if (!pool.options.connectionString) {
    console.warn("Skipping schema check: DATABASE_URL not provided.");
    return;
  }

  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
    await pool.query(`CREATE TABLE IF NOT EXISTS art_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      prompt text NOT NULL,
      result_type text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      config jsonb NOT NULL,
      rectangles jsonb NOT NULL,
      canvas_width integer NOT NULL,
      canvas_height integer NOT NULL
    );`);
    await pool.query(
      "CREATE INDEX IF NOT EXISTS art_history_created_at_idx ON art_history (created_at DESC);"
    );
    console.log("Database schema verified (art_history ready).");
  } catch (error) {
    console.error("Failed to ensure schema", error);
    throw error;
  }
}

function validateHistoryPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "Body must be a JSON object.";
  }

  const { prompt, resultType, config, rectangles, canvasWidth, canvasHeight } = payload;

  if (typeof prompt !== "string") return "`prompt` must be a string.";
  if (typeof resultType !== "string") return "`resultType` must be a string.";
  if (!config || typeof config !== "object") return "`config` must be an object.";
  if (!Array.isArray(rectangles)) return "`rectangles` must be an array.";
  if (!Number.isFinite(canvasWidth)) return "`canvasWidth` must be numeric.";
  if (!Number.isFinite(canvasHeight)) return "`canvasHeight` must be numeric.";

  return null;
}

async function fetchHistory(req, res) {
  if (!pool.options.connectionString) {
    return res.status(500).json({ error: "DATABASE_URL is not configured." });
  }

  try {
    const { rows } = await pool.query(
      `SELECT
        id::text AS id,
        prompt,
        result_type AS "resultType",
        created_at AS "createdAt",
        config,
        rectangles,
        canvas_width AS "canvasWidth",
        canvas_height AS "canvasHeight"
      FROM art_history
      ORDER BY created_at DESC
      LIMIT $1`,
      [HISTORY_LIMIT]
    );

    res.json({ items: rows });
  } catch (error) {
    console.error("Failed to fetch history", error);
    res.status(500).json({ error: "Failed to fetch history." });
  }
}

async function saveHistory(req, res) {
  if (!pool.options.connectionString) {
    return res.status(500).json({ error: "DATABASE_URL is not configured." });
  }

  const validationError = validateHistoryPayload(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const { prompt, resultType, config, rectangles, canvasWidth, canvasHeight } = req.body;

  let configJson;
  let rectanglesJson;

  try {
    configJson = JSON.stringify(config);
    rectanglesJson = JSON.stringify(rectangles);
  } catch (stringifyError) {
    console.error("Failed to stringify history payload", stringifyError);
    return res.status(400).json({ error: "Unable to serialize history payload." });
  }

  const insertSql = `INSERT INTO art_history (
    prompt,
    result_type,
    config,
    rectangles,
    canvas_width,
    canvas_height
  ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
  RETURNING
    id::text AS id,
    prompt,
    result_type AS "resultType",
    created_at AS "createdAt",
    config,
    rectangles,
    canvas_width AS "canvasWidth",
    canvas_height AS "canvasHeight";`;

  try {
    const { rows } = await pool.query(insertSql, [
      prompt,
      resultType,
      configJson,
      rectanglesJson,
      Math.round(Number(canvasWidth)),
      Math.round(Number(canvasHeight)),
    ]);

    res.status(201).json({ item: rows[0] });
  } catch (error) {
    console.error("Failed to save history", error);
    res.status(500).json({ error: "Failed to save history." });
  }
}

app.get("/api/history", fetchHistory);
app.post("/api/history", saveHistory);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, timestamp: Date.now() });
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

async function startServer() {
  try {
    await ensureSchema();
    app.listen(PORT, () => {
      console.log(`Neon history server listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Server failed to start due to schema initialization error.");
    process.exit(1);
  }
}

startServer();
