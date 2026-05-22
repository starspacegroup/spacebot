import { execSync } from "node:child_process";
import http from "node:http";

/**
 * Check if Ollama is installed
 */
export async function detectOllamaInstalled(): Promise<boolean> {
  try {
    execSync("which ollama", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Ollama server is running
 */
export async function detectOllamaRunning(host: string = "localhost", port: number = 11434): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host,
        port,
        path: "/api/tags",
        method: "GET",
        timeout: 2000,
      },
      (res) => {
        resolve(res.statusCode === 200);
      }
    );

    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

interface OllamaGenerateResponse {
  response?: string;
  error?: string;
  model?: string;
  eval_count?: number;
  prompt_eval_count?: number;
  total_duration?: number;
  eval_duration?: number;
}

export interface OllamaGenerateStats {
  evalCount?: number;
  promptEvalCount?: number;
  totalDurationMs?: number;
  evalDurationMs?: number;
  model?: string;
}

/**
 * Get list of available Ollama models
 */
export async function getOllamaModels(host: string = "localhost", port: number = 11434): Promise<OllamaModel[]> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host,
        port,
        path: "/api/tags",
        method: "GET",
        timeout: 3000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            resolve((parsed.models as OllamaModel[]) || []);
          } catch {
            resolve([]);
          }
        });
      }
    );

    req.on("error", () => resolve([]));
    req.on("timeout", () => {
      req.destroy();
      resolve([]);
    });

    req.end();
  });
}

/**
 * Format bytes to human readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 10) / 10 + " " + sizes[i];
}

/**
 * Store Ollama config
 */
export function storeOllamaConfig(config: { host: string; port: number; model: string }): void {
  // Store in environment or config file
  process.env.OLLAMA_HOST = config.host;
  process.env.OLLAMA_PORT = String(config.port);
  process.env.OLLAMA_MODEL = config.model;
}

/**
 * Get stored Ollama config
 */
export function getOllamaConfig(): { host: string; port: number; model: string } | null {
  const host = process.env.OLLAMA_HOST;
  const port = process.env.OLLAMA_PORT;
  const model = process.env.OLLAMA_MODEL;

  if (!host || !port || !model) return null;

  return {
    host,
    port: parseInt(port, 10),
    model,
  };
}

/**
 * Generate a response from an Ollama model.
 */
export async function generateOllamaResponse(options: {
  model: string;
  prompt: string;
  host?: string;
  port?: number;
}): Promise<{ ok: true; text: string; stats: OllamaGenerateStats } | { ok: false; error: string }> {
  const host = options.host ?? "localhost";
  const port = options.port ?? 11434;

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host,
        port,
        path: "/api/generate",
        method: "POST",
        timeout: 30000,
        headers: {
          "content-type": "application/json",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            resolve({ ok: false, error: `Ollama returned HTTP ${res.statusCode}.` });
            return;
          }

          try {
            const parsed = JSON.parse(data) as OllamaGenerateResponse;
            const text = (parsed.response ?? "").trim();
            if (!text) {
              resolve({ ok: false, error: parsed.error || "Ollama returned an empty response." });
              return;
            }
            const stats: OllamaGenerateStats = {
              evalCount: parsed.eval_count,
              promptEvalCount: parsed.prompt_eval_count,
              totalDurationMs: typeof parsed.total_duration === "number" ? parsed.total_duration / 1_000_000 : undefined,
              evalDurationMs: typeof parsed.eval_duration === "number" ? parsed.eval_duration / 1_000_000 : undefined,
              model: parsed.model,
            };
            resolve({ ok: true, text, stats });
          } catch {
            resolve({ ok: false, error: "Failed to parse Ollama response." });
          }
        });
      }
    );

    req.on("error", () => resolve({ ok: false, error: "Could not connect to Ollama." }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "Timed out waiting for Ollama response." });
    });

    req.write(
      JSON.stringify({
        model: options.model,
        prompt: options.prompt,
        stream: false,
      })
    );
    req.end();
  });
}
