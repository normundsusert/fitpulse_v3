# FitPulse GPT backend (Cloudflare Worker)

This backend keeps the OpenAI API key off GitHub Pages.

1. Install Wrangler: `npm install -g wrangler`
2. Sign in: `wrangler login`
3. In this `backend` folder run: `wrangler secret put OPENAI_API_KEY` and paste your OpenAI API key.
4. Deploy: `wrangler deploy`
5. Copy the Worker URL and add `/api/chat`, e.g. `https://fitpulse-ai.<subdomain>.workers.dev/api/chat`.
6. In FitPulse → GPT trainer → GPT connection & memory, paste that URL and tap Check GPT.

`ALLOWED_ORIGIN` is already set for `https://normundsusert.github.io`. Change it if the web app is hosted elsewhere.
The default model is `gpt-6-luna`; change `OPENAI_MODEL` in `wrangler.toml` if needed.
