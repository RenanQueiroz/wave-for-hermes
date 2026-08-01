/**
 * A self-contained prompt the user hands to a coding agent on the machine
 * that runs Hermes. The agent sets up the Wave Companion and replies with
 * the URL and pairing code to enter on the Connect screen. The prompt
 * contains no secrets and explicitly forbids echoing credential values.
 */
export const COMPANION_SETUP_PROMPT = `Set up the Wave Companion on this machine so my phone can pair with it over Tailscale.

The companion is the trusted server-side backend for the Wave mobile app. It keeps the Hermes and OpenAI credentials on this machine; my phone only ever receives a revocable device credential.

1. Clone https://github.com/RenanQueiroz/wave-for-hermes and build the production container from the repository root:
   docker build --file companion/Dockerfile --build-arg WAVE_COMPANION_REVISION="$(git rev-parse HEAD)" --tag wave-companion .
   If Docker is not available, run it directly with Node.js 24 instead: npm install, npm run companion:build, npm run companion:start.
2. Run it with the Hermes credentials this machine already uses. The companion README documents the required environment variables: the Hermes API base URL and the server-only Hermes API key. Provide them as environment variables; never write the key into a file that could be committed and never print its value. Optionally provide the server-only OpenAI key variable the README names to enable live voice. In a container, set WAVE_HOST=0.0.0.0, publish port 8787, mount a private writable volume for WAVE_DATABASE_PATH so pairing state survives restarts, and use a restart policy so the companion survives reboots.
3. Make it reachable from my phone through Tailscale. Install and authenticate Tailscale if it is missing — if that requires opening a URL or an auth key, tell me exactly what to do. Prefer "tailscale serve --bg 8787" so the companion gets a real HTTPS hostname. If Tailscale Serve is unavailable on my tailnet, serving plain HTTP on the machine's tailnet address is acceptable: the Wave app allows http:// only for Tailscale 100.64.0.0/10 addresses, where the tunnel already encrypts the traffic. Never expose the companion to the public internet.
4. Verify it works: curl the companion's /v1/status endpoint through the exact URL my phone will use.
5. Mint a one-time pairing code inside the deployed companion:
   docker exec <container> node companion/dist/admin.js pair
   (or "npm run companion:pair" for a non-container install, against the same WAVE_DATABASE_PATH). A code can be redeemed exactly once and expires after about ten minutes, so be ready to mint a fresh one when I pair.

Reply with:
- The exact companion URL I enter in the Wave app
- The pairing code, or the exact command I run to mint a fresh one
- Any setup steps I still need to do on my phone

Do not disable the companion's authentication, and do not echo the Hermes or OpenAI key values anywhere in your reply.`;

export const COMPANION_SETUP_PROMPT_SHARE_TITLE = 'Wave Companion setup prompt';
