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

export default async function (pi: ExtensionAPI) {
  const response = await fetch(MODELS_ENDPOINT, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    },
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
