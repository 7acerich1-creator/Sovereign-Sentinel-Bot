// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Webhook Triggers
// Expose HTTP endpoints for incoming webhooks
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import * as http from "http";
import { randomUUID } from "crypto";
import { config } from "../config";

type WebhookHandler = (payload: unknown, headers: http.IncomingHttpHeaders) => Promise<string>;

export class WebhookServer {
  private server: http.Server | null = null;
  private routes: Map<string, WebhookHandler> = new Map();

  register(path: string, handler: WebhookHandler): void {
    this.routes.set(path, handler);
    console.log(`🔗 Webhook registered: POST ${path}`);
  }

  unregister(path: string): void {
    this.routes.delete(path);
  }

  async start(): Promise<void> {
    if (!config.webhooks.enabled) {
      console.log("ℹ️ Webhook server disabled in config");
      return;
    }

    this.server = http.createServer(async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(404);
        res.end();
        return;
      }

      const handler = this.routes.get(req.url || "");
      if (!handler) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      let body = "";
      req.on("data", (chunk) => { body += chunk.toString(); });
      req.on("end", async () => {
        try {
          let payload: unknown;
          try {
            payload = JSON.parse(body);
          } catch {
            payload = body;
          }

          const result = await handler(payload, req.headers);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", result }));
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "error", error: err.message }));
        }
      });
    });

    const port = config.webhooks.port;
    this.server.listen(port, () => {
      console.log(`🌐 Webhook server listening on port ${port}`);
    });
  }

  async shutdown(): Promise<void> {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
