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
