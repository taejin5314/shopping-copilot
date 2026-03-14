import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ask } from "./ask.js";
import type { CopilotConfig } from "./ask.js";
import { CopilotError } from "../core/types.js";

// ──────────────────────────────────────────────
// Thin HTTP transport — POST /ask + GET /health
// ──────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(
  resolve(__dirname, "../../public/index.html"),
  "utf-8",
);

const BODY_LIMIT = 256 * 1024; // 256 KB

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      raw += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" }).end(payload);
}

export function createHttpServer(config: CopilotConfig) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "";
    const url = req.url ?? "";

    try {
      if (url === "/" && method === "GET") {
        res
          .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          .end(INDEX_HTML);
        return;
      }

      if (url === "/health" && method === "GET") {
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (url === "/ask" && method === "POST") {
        const body = await readBody(req);
        const result = await ask(body, config);
        sendJson(res, 200, result);
        return;
      }

      res.writeHead(404).end("Not found");
    } catch (err) {
      if (err instanceof CopilotError && err.code === "INVALID_ITEM") {
        sendJson(res, 400, { error: err.code, message: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : "internal error";
      console.error(`ERROR ${method} ${url}:`, message);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "INTERNAL", message });
      }
    }
  });
}
