// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Webhook Triggers
// Expose HTTP endpoints for incoming webhooks
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import * as http from "http";
import { randomUUID } from "crypto";
import { config } from "../config";

type WebhookHandler = (payload: unknown, headers: http.IncomingHttpHeaders, rawBody?: string) => Promise<string>;

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

      // TikTok domain verification — serves the verification signature file
      if (req.method === "GET" && req.url === "/tiktok-developers-site-verification.txt") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("tiktok-developers-site-verification=n7lNKYkofPRzHuXTzRv9BZKi8VLC5NBO");
        return;
      }

      // GET /legal/* — serve Terms of Service and Privacy Policy (required for TikTok/Meta app review)
      if (req.method === "GET" && req.url?.startsWith("/legal/")) {
        const LEGAL_PAGES: Record<string, { title: string; content: string }> = {
          "/legal/terms": {
            title: "Terms of Service",
            content: `<h1>Terms of Service</h1><p class="updated">Last updated: March 30, 2026</p><h2>1. Acceptance of Terms</h2><p>By accessing or using Sovereign Synthesis services, applications, and content distribution platform ("Service"), you agree to be bound by these Terms of Service.</p><h2>2. Description of Service</h2><p>Sovereign Synthesis is a content management and distribution platform that creates and publishes educational and personal development content across social media platforms including TikTok, Instagram, YouTube, and other channels.</p><h2>3. User Accounts and Authorization</h2><p>The Service operates under the authorization of the account owner. By connecting your social media accounts, you grant Sovereign Synthesis permission to publish content on your behalf. You may revoke this authorization at any time.</p><h2>4. Content Ownership</h2><p>You retain all rights to content created and published through the Service.</p><h2>5. Prohibited Uses</h2><p>You agree not to use the Service to publish content that is illegal, harmful, threatening, abusive, or otherwise objectionable.</p><h2>6. API Usage</h2><p>The Service integrates with third-party APIs including TikTok Content Posting API, Instagram Graph API, and YouTube Data API. Your use is subject to each platform's terms.</p><h2>7. Privacy</h2><p>Your use is governed by our <a href="/legal/privacy">Privacy Policy</a>.</p><h2>8. Limitation of Liability</h2><p>The Service is provided "as is" without warranties of any kind.</p><h2>9. Contact</h2><p>Questions: empoweredservices2013@gmail.com</p>`,
          },
          "/legal/privacy": {
            title: "Privacy Policy",
            content: `<h1>Privacy Policy</h1><p class="updated">Last updated: March 30, 2026</p><h2>1. Introduction</h2><p>Sovereign Synthesis operates a content management and distribution platform. This Privacy Policy explains how we collect, use, and protect information.</p><h2>2. Information We Collect</h2><p>OAuth access tokens for authorized social media accounts, basic profile information (username, account ID), and content publishing metadata. We do not collect personal data from audiences of published content.</p><h2>3. How We Use Information</h2><p>Information is used solely for publishing content to connected accounts, monitoring publishing success, and maintaining service functionality.</p><h2>4. Data Storage and Security</h2><p>Access tokens are stored securely using encrypted environment variables on Railway cloud infrastructure. We do not sell, rent, or share your data.</p><h2>5. Third-Party Services</h2><p>We integrate with TikTok Content Posting API, Instagram Graph API (Meta), and YouTube Data API (Google). Your use is subject to each platform's privacy policy.</p><h2>6. Data Retention</h2><p>Tokens are retained only while accounts are connected. You may revoke access at any time.</p><h2>7. Your Rights</h2><p>You may request access to stored data, request deletion, revoke API access, and opt out of the Service.</p><h2>8. Children's Privacy</h2><p>The Service is not directed at children under 13.</p><h2>9. Contact</h2><p>Privacy inquiries: empoweredservices2013@gmail.com</p>`,
          },
        };

        const page = LEGAL_PAGES[req.url];
        if (page) {
          const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${page.title} — Sovereign Synthesis</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:40px 20px;color:#e0e0e0;background:#0a0a0f;line-height:1.7}h1{color:#00f0ff;border-bottom:1px solid #1a1a2e;padding-bottom:16px}h2{color:#b8b8cc;margin-top:32px}a{color:#00f0ff}.updated{color:#666;font-size:14px}</style></head><body>${page.content}</body></html>`;
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
          return;
        }
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
                  outputDimensionality: 1024,
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

          const result = await handler(payload, req.headers, body);
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
