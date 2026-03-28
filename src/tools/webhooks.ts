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
      // GET /health — lightweight probe for Railway / load balancers
      if (req.method === "GET" && (req.url === "/health" || req.url === "/api/health")) {
        const health: Record<string, unknown> = {
          status: "ok",
          uptime: process.uptime(),
          pinecone: !!process.env.PINECONE_API_KEY && !!process.env.PINECONE_HOST,
          supabase: !!config.memory.supabaseUrl && !!config.memory.supabaseKey,
          gemini: !!config.llm.providers.gemini?.apiKey,
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(health));
        return;
      }

      // GET /debug/memory — diagnostic for memory pipeline (temporary)
      if (req.method === "GET" && req.url === "/debug/memory") {
        try {
          const { createClient } = await import("@supabase/supabase-js");
          const diag: Record<string, unknown> = {
            supabaseUrl: !!config.memory.supabaseUrl,
            supabaseKey: !!config.memory.supabaseKey,
            supabaseKeyLength: config.memory.supabaseKey?.length || 0,
          };

          if (config.memory.supabaseUrl && config.memory.supabaseKey) {
            const supabase = createClient(config.memory.supabaseUrl, config.memory.supabaseKey);

            const { data: kn, error: knErr } = await supabase
              .from("knowledge_nodes")
              .select("id, agent_name", { count: "exact" })
              .limit(3);
            diag.knowledge_nodes_count = kn?.length ?? 0;
            diag.knowledge_nodes_error = knErr?.message || null;
            diag.knowledge_nodes_sample = kn?.map((r: any) => r.agent_name) || [];

            const { data: sl, error: slErr } = await supabase
              .from("sync_log")
              .select("id, status", { count: "exact" })
              .limit(3);
            diag.sync_log_count = sl?.length ?? 0;
            diag.sync_log_error = slErr?.message || null;

            // Test Gemini embedding
            const geminiKey = config.llm.providers.gemini?.apiKey;
            if (geminiKey) {
              const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`;
              const embedRes = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: "models/gemini-embedding-001",
                  content: { parts: [{ text: "test embedding" }] },
                  outputDimensionality: 768,
                }),
              });
              diag.gemini_embed_status = embedRes.status;
              if (embedRes.ok) {
                const embedData = (await embedRes.json()) as any;
                diag.gemini_embed_dims = embedData.embedding?.values?.length || 0;
              } else {
                diag.gemini_embed_error = await embedRes.text();
              }
            }

            // Test Pinecone
            const pcHost = process.env.PINECONE_HOST;
            const pcKey = process.env.PINECONE_API_KEY;
            if (pcHost && pcKey) {
              const pcRes = await fetch(`${pcHost}/describe_index_stats`, {
                method: "POST",
                headers: { "Api-Key": pcKey, "Content-Type": "application/json" },
                body: "{}",
              });
              diag.pinecone_status = pcRes.status;
              if (pcRes.ok) {
                const pcData = (await pcRes.json()) as any;
                diag.pinecone_vectors = pcData.totalVectorCount || 0;
                diag.pinecone_namespaces = Object.keys(pcData.namespaces || {});
              } else {
                diag.pinecone_error = await pcRes.text();
              }
            }
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(diag, null, 2));
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

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
