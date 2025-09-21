# Rectangle Joy

The delight of creating abstract rectangle art.

Type a prompt and watch an LLM provided by OpenAI conduct thousands of
rectangles into a meditative composition. The project blends
lightweight math, WebGL shaders, and an Express bridge backed by Neon
serverless Postgres to store each generated canvas for later replay.

![art work of lounging on the beach](lounging-on-the-beach.jpg)

Built at the [Cascadia AI Hackathon 2025](https://luma.com/yu2ccnvr) by [Brian Gershon](https://briangershon.com).

# Hackathon Project

This is a hackathon project so please don't host this publicly since it will expose your OpenAI key. The LLM logic needs to move to the backend to run on the open internet.

# Development

There's no build process, so you just need to run the backend and then serve the frontend files.

- Configure .env and config.js as described below. See warning above about `config.js` not being a secure way to store secrets. Just run this locally.
- Run the server via `npm start` to support persistence via Neon.
- Use a static HTTP server such as Node-based `http-server` to load index.html

## OpenAI Configuration

1. Copy `config.js` from the example below and place it at the project root if it does not already exist:

   ```js
   // config.js
   const OPENAI_API_KEY = ""; // paste your key between the quotes
   ```

2. Paste your OpenAI API key between the quotes. The agent will refuse to run prompts if the constant is empty.

3. Ensure `config.js` is listed in `.gitignore` (already configured) so credentials are never committed. Create separate keys per environment if you share the repo.

## History Persistence (Express + Neon)

The "Previous Art" panel now talks to a tiny Express backend that relays requests to Neon. To turn it on:

1. **Create a Neon project** and when you first run the server the `art_history` table will automatically be created.

2. **Create a low-privilege Neon role** (read/write on `art_history`) and copy its connection string (`postgres://user:password@host/database`).

3. **Install server dependencies** and configure environment variables:

   ```bash
   npm install

   cat <<'EOF' > .env
   DATABASE_URL=postgres://readonly_user:strongpass@ep-sweet-123456.us-east-2.aws.neon.tech/neondb
   PORT=8787           # optional
   HISTORY_LIMIT=10    # optional cap for the returned rows
   EOF
   ```

   The server reads `.env` via `dotenv`. `DATABASE_URL` is mandatory.

4. **Run the Express bridge:**

   ```bash
   npm start
   ```

   It exposes `GET /api/history` and `POST /api/history` on `http://localhost:8787` by default.

5. **Point the front-end at the server.** Edit `config.js` if your Express app runs on a different origin:

   ```js
   const HISTORY_API_BASE = "http://localhost:8787"; // leave blank if same origin
   ```

   The UI will automatically load previous runs and persist new ones through the backend.
