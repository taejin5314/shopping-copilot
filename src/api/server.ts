import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { ask } from "./ask.js";
import type { CopilotConfig } from "./ask.js";
import { CopilotError } from "../core/types.js";
import { logEvent } from "../events/event-logger.js";
import type { ShopilotEvent } from "../events/event-logger.js";

// ──────────────────────────────────────────────
// Thin HTTP transport — POST /ask + GET /health
// ──────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "../../public");
const INDEX_HTML = readFileSync(
  resolve(PUBLIC_DIR, "index.html"),
  "utf-8",
);

const MIME: Record<string, string> = {
  ".js":  "application/javascript",
  ".css": "text/css",
  ".map": "application/json",
};

const BODY_LIMIT = 256 * 1024; // 256 KB
const EVENTS_BODY_LIMIT = 64 * 1024; // 64 KB — events are small
const BUILD_TS = new Date().toISOString();

function readBody(req: IncomingMessage, limit = BODY_LIMIT): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
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
        sendJson(res, 200, { status: "ok", build: BUILD_TS, version: "0.1.1" });
        return;
      }

      if (url.startsWith("/assets/") && method === "GET") {
        const assetPath = resolve(PUBLIC_DIR, url.slice(1)); // strip leading /
        if (assetPath.startsWith(PUBLIC_DIR) && existsSync(assetPath)) {
          const mime = MIME[extname(assetPath)] ?? "application/octet-stream";
          const data = readFileSync(assetPath);
          res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public,max-age=31536000,immutable" }).end(data);
        } else {
          res.writeHead(404).end("Not found");
        }
        return;
      }

      if (url === "/ask" && method === "POST") {
        const sessionId = req.headers["x-session-id"] as string | undefined;
        const body = await readBody(req);
        const result = await ask(body, config, sessionId);
        sendJson(res, 200, result);
        return;
      }

      if (url === "/events" && method === "POST") {
        const body = await readBody(req, EVENTS_BODY_LIMIT);
        if (body && typeof body === "object") {
          // Trust the client-sent session_id and ts; re-stamp ts server-side for safety.
          const event = body as Partial<ShopilotEvent>;
          logEvent({
            ...(event as Omit<ShopilotEvent, "_log_type">),
            ts: new Date().toISOString(), // always use server time
          });
        }
        res.writeHead(204).end();
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
