/**
 * Featherless.ai Provider Extension
 *
 * Dynamically fetches all available models from the Featherless.ai /v1/models
 * endpoint and registers them as an OpenAI-compatible provider.
 *
 * Usage:
 *   FEATHERLESS_API_KEY=your-key pi -e ~/.pi/agent/extensions/featherless
 *
 * Or add to settings.json packages array and set the env var.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE_URL = "https://api.featherless.ai/v1";
const MODELS_ENDPOINT = `${BASE_URL}/models`;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 10_000;

interface FeatherlessModel {
  id: string;
  context_length: number;
  model_class: string;
  features?: { tool_use?: boolean } | null;
  max_completion_tokens?: number | null;
  concurrency_cost: number;
  is_gated: boolean;
  created: number;
  owned_by: string;
}

// Module-level so a flurry of session_start events (startup + /reload) only
// triggers one in-flight fetch. Reset to undefined on completion.
let pendingRefresh: Promise<void> | undefined;

async function doRefresh(pi: ExtensionAPI): Promise<void> {
  const response = await fetch(MODELS_ENDPOINT, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Featherless models fetch failed: ${response.status} ${response.statusText}`,
    );
  }
  const payload = (await response.json()) as { data: FeatherlessModel[] };
  pi.registerProvider("featherless", {
    name: "Featherless.ai",
    baseUrl: BASE_URL,
    apiKey: "$FEATHERLESS_API_KEY",
    api: "openai-completions",
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
    models: payload.data.map((model) => ({
      id: model.id,
      name: model.id,
      reasoning: false,
      input: ["text"] as const,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.context_length ?? 32768,
      maxTokens: model.max_completion_tokens ?? 4096,
    })),
  });
}

function refreshFeatherlessModels(pi: ExtensionAPI): Promise<void> {
  if (!pendingRefresh) {
    pendingRefresh = doRefresh(pi)
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        // Stale-extension errors fire when the user /reload'd mid-fetch; the
        // new extension instance will pick up the next refresh. Skip the
        // warning so the user doesn't see noise for an expected race.
        if (detail.toLowerCase().includes("stale")) return;
        console.warn(
          `[featherless] could not refresh model list: ${detail}. ` +
            `Run /reload to retry.`,
        );
      })
      .finally(() => {
        pendingRefresh = undefined;
      });
  }
  return pendingRefresh;
}

export default function (pi: ExtensionAPI) {
  // Kick off the initial fetch in the background. The factory must not
  // await it: pi blocks on the factory, and a slow / unreachable
  // api.featherless.ai would delay the whole TUI from coming up.
  void refreshFeatherlessModels(pi);

  // Refresh on every session boundary (startup, /new, /resume, /fork,
  // /reload) so the model list stays in sync with the API across long
  // sessions. refreshFeatherlessModels dedupes against the in-flight
  // fetch above, so this is a no-op when the startup fetch is still
  // running and a real refresh once it has completed.
  pi.on("session_start", () => {
    void refreshFeatherlessModels(pi);
  });

  // Normalise Featherless context overflow errors so pi recognises them.
  // Featherless returns: "400 Maximum context length ... exceeds the maximum
  // context length limit by N tokens" which doesn't match pi's built-in
  // overflow patterns. Rewrite to the generic fallback prefix.
  const FEATHERLESS_OVERFLOW = /exceeds the maximum context length limit/i;

  pi.on("message_end", (event, ctx) => {
    const message = event.message;
    if (message.role !== "assistant") return;
    if (message.stopReason !== "error") return;
    if (
      message.provider !== "featherless" &&
      ctx.model?.provider !== "featherless"
    )
      return;

    const errorMessage = message.errorMessage ?? "";
    if (errorMessage.includes("context_length_exceeded")) return;
    if (!FEATHERLESS_OVERFLOW.test(errorMessage)) return;

    return {
      message: {
        ...message,
        errorMessage: `context_length_exceeded: ${errorMessage}`,
      },
    };
  });
}
