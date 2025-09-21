# Rectangle Packing Agent

Goal is to define minimal primatives and do most of the heavy-lifting generative art via an LLM.

# Development

No build process. Serve via a static file server such as node-based `http-server`.

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

> ⚠️ Since the API endpoint can be called from the browser, ensure the Neon role you use here only has access to the `art_history` table.
