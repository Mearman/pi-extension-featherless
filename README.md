# pi-extension-featherless

> Pi extension that dynamically fetches all available models from Featherless.ai and registers them as an OpenAI-compatible provider.

TypeScript · pi Extension API

## Getting started

Requires `FEATHERLESS_API_KEY` set in the environment.

### Install from remote

```bash
pi install git:github.com/Mearman/pi-extension-featherless
```

### Try without installing

```bash
pi -e git:github.com/Mearman/pi-extension-featherless
```

### Run from a local clone

```bash
pi -e /path/to/pi-extension-featherless
```

No dependencies to install — the extension runs directly from `index.ts` via pi's extension loader.

## Architecture

Single entry point (`index.ts`) that:

1. Fetches `https://api.featherless.ai/v1/models` at load time and maps every returned model to pi's provider model schema.
2. Registers a `"featherless"` provider with OpenAI-completions API compatibility.
3. Intercepts `message_end` events to rewrite Featherless-specific context overflow error messages into the `context_length_exceeded` pattern pi recognises.

All models are free-tier (`cost: { input: 0, output: 0 }`). Context window and max completion tokens are sourced from the API response.

## Conventions

- No build step — pi loads the extension directly from TypeScript.
- The `clean`, `build`, and `check` scripts are placeholders and do nothing.
