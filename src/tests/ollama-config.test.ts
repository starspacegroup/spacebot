import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOllamaConfig,
  getExplicitOllamaEnvConfig,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_OLLAMA_PORT,
} from "../../scripts/local-runner/ollama-utils.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ollama default config", () => {
  it("defaults to gemma3:4b at localhost:11434 when no env is set", () => {
    vi.stubEnv("OLLAMA_HOST", "");
    vi.stubEnv("OLLAMA_PORT", "");
    vi.stubEnv("OLLAMA_MODEL", "");

    const config = getOllamaConfig();
    expect(config.model).toBe("gemma3:4b");
    expect(config.host).toBe("localhost");
    expect(config.port).toBe(11434);

    // Constants are the source of truth used elsewhere (runner chain, app AI).
    expect(DEFAULT_OLLAMA_MODEL).toBe("gemma3:4b");
    expect(DEFAULT_OLLAMA_HOST).toBe("localhost");
    expect(DEFAULT_OLLAMA_PORT).toBe(11434);
  });

  it("honors OLLAMA_MODEL / OLLAMA_HOST / OLLAMA_PORT overrides per field", () => {
    vi.stubEnv("OLLAMA_MODEL", "llama3:8b");
    vi.stubEnv("OLLAMA_HOST", "10.0.0.5");
    vi.stubEnv("OLLAMA_PORT", "1234");

    const config = getOllamaConfig();
    expect(config.model).toBe("llama3:8b");
    expect(config.host).toBe("10.0.0.5");
    expect(config.port).toBe(1234);
  });

  it("getExplicitOllamaEnvConfig is null unless ALL three env vars are set", () => {
    vi.stubEnv("OLLAMA_HOST", "");
    vi.stubEnv("OLLAMA_PORT", "");
    vi.stubEnv("OLLAMA_MODEL", "");
    expect(getExplicitOllamaEnvConfig()).toBeNull();

    // Partial config is still null (precedence helper requires an explicit, complete override).
    vi.stubEnv("OLLAMA_MODEL", "gemma3:4b");
    expect(getExplicitOllamaEnvConfig()).toBeNull();

    vi.stubEnv("OLLAMA_HOST", "localhost");
    vi.stubEnv("OLLAMA_PORT", "11434");
    expect(getExplicitOllamaEnvConfig()).toEqual({ host: "localhost", port: 11434, model: "gemma3:4b" });
  });
});
