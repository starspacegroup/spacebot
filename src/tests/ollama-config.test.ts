import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOllamaConfig,
  resolveOllamaConfig,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_OLLAMA_PORT,
} from "../../scripts/local-runner/ollama-utils.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ollama config defaults & precedence", () => {
  it("defaults to gemma3:4b at localhost:11434 when nothing is configured", () => {
    vi.stubEnv("OLLAMA_HOST", "");
    vi.stubEnv("OLLAMA_PORT", "");
    vi.stubEnv("OLLAMA_MODEL", "");

    const cfg = resolveOllamaConfig();
    expect(cfg.model).toBe("gemma3:4b");
    expect(cfg.host).toBe("localhost");
    expect(cfg.port).toBe(11434);

    expect(DEFAULT_OLLAMA_MODEL).toBe("gemma3:4b");
    expect(DEFAULT_OLLAMA_HOST).toBe("localhost");
    expect(DEFAULT_OLLAMA_PORT).toBe(11434);
  });

  it("resolveOllamaConfig honors a single OLLAMA_MODEL override even with a persisted config (per-field precedence)", () => {
    vi.stubEnv("OLLAMA_HOST", "");
    vi.stubEnv("OLLAMA_PORT", "");
    vi.stubEnv("OLLAMA_MODEL", "llama3:8b");

    // env model wins; host/port fall back to the persisted values.
    const cfg = resolveOllamaConfig({ host: "10.0.0.5", port: 1234, model: "mistral" });
    expect(cfg.model).toBe("llama3:8b");
    expect(cfg.host).toBe("10.0.0.5");
    expect(cfg.port).toBe(1234);
  });

  it("resolveOllamaConfig uses the persisted config when no env override is present", () => {
    vi.stubEnv("OLLAMA_HOST", "");
    vi.stubEnv("OLLAMA_PORT", "");
    vi.stubEnv("OLLAMA_MODEL", "");

    const cfg = resolveOllamaConfig({ host: "persist-host", port: 9999, model: "persist-model" });
    expect(cfg).toEqual({ host: "persist-host", port: 9999, model: "persist-model" });
  });

  it("getOllamaConfig is null unless ALL three OLLAMA_* env vars are set (honest 'configured' signal)", () => {
    vi.stubEnv("OLLAMA_HOST", "");
    vi.stubEnv("OLLAMA_PORT", "");
    vi.stubEnv("OLLAMA_MODEL", "");
    expect(getOllamaConfig()).toBeNull();

    // Partial config is still null — a default fallback must NOT read as "configured".
    vi.stubEnv("OLLAMA_MODEL", "gemma3:4b");
    expect(getOllamaConfig()).toBeNull();

    vi.stubEnv("OLLAMA_HOST", "localhost");
    vi.stubEnv("OLLAMA_PORT", "11434");
    expect(getOllamaConfig()).toEqual({ host: "localhost", port: 11434, model: "gemma3:4b" });
  });
});
