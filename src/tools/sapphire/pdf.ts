// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sapphire PA — PDF Reader Tool (Gap 2)
// Session 114 (S114n) — 2026-04-25
//
// Takes a Telegram document file_id (sent as a PDF), downloads via Sapphire's
// own bot token, splits to base64 page images, runs Gemini Flash vision on
// each, returns structured extraction. Reads contracts, statements, school
// flyers, anything PDF.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../../types";

const GEMINI_VISION_MODEL = "gemini-2.5-flash";
const MAX_PAGES = 20; // hard cap to prevent runaway cost

async function downloadPdfWithSapphireToken(fileId: string): Promise<Buffer | null> {
  const sapphireToken = process.env.SAPPHIRE_TOKEN;
  if (!sapphireToken) return null;
  try {
    const getFileResp = await fetch(`https://api.telegram.org/bot${sapphireToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
    if (!getFileResp.ok) return null;
    const data = (await getFileResp.json()) as any;
    const filePath = data?.result?.file_path;
    if (!filePath) return null;
    const fileResp = await fetch(`https://api.telegram.org/file/bot${sapphireToken}/${filePath}`);
    if (!fileResp.ok) return null;
    return Buffer.from(await fileResp.arrayBuffer());
  } catch {
    return null;
  }
}

async function pdfToImages(pdfBuf: Buffer): Promise<string[]> {
  // Use pdf-parse / pdf-to-png-converter — but those require native deps.
  // Cleaner: use pdf.js-extract via require, fall back to sending raw PDF bytes
  // to Gemini (which supports application/pdf as inline_data directly).
  // Actually: Gemini 2.5 Flash supports PDF input natively via inline_data!
  // No image conversion needed. Return single-element array with full PDF base64.
  return [pdfBuf.toString("base64")];
}

export class AnalyzePdfTool implements Tool {
  definition: ToolDefinition = {
    name: "analyze_pdf",
    description:
      "Read a PDF file Ace sent (contract, bank statement, school flyer, receipt, etc) and extract all relevant info. Returns plain-text structured extraction. Use when Ace sends a document attachment.",
    parameters: {
      file_id: {
        type: "string",
        description: "Telegram file_id of the PDF document Ace sent.",
      },
      focus: {
        type: "string",
        description: "Optional. What to focus on: 'dates_and_amounts' | 'parties_and_signatures' | 'action_items' | 'all'. Default 'all'.",
      },
    },
    required: ["file_id"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const fileId = String(args.file_id || "");
    const focus = String(args.focus || "all");
    if (!fileId) return "analyze_pdf: file_id required.";

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return "analyze_pdf: GEMINI_API_KEY not set.";

    const pdfBuf = await downloadPdfWithSapphireToken(fileId);
    if (!pdfBuf) return "analyze_pdf: could not download PDF from Telegram.";
    if (pdfBuf.length > 20 * 1024 * 1024) {
      return `analyze_pdf: file too large (${(pdfBuf.length / 1024 / 1024).toFixed(1)}MB, max 20MB).`;
    }

    const focusPrompts: Record<string, string> = {
      dates_and_amounts: "Extract all dates, deadlines, dollar amounts, and quantities. List them clearly.",
      parties_and_signatures: "Identify all named parties, signatories, addresses, and their roles. Flag any signature fields that need to be signed.",
      action_items: "Extract all action items, deadlines, and what Ace specifically needs to do. Be specific about who-does-what-by-when.",
      all: "Extract all important information: dates, amounts, parties, action items, key terms, deadlines, RSVPs, anything actionable. Group by category. Be thorough but concise. Plain text.",
    };
    const focusPrompt = focusPrompts[focus] || focusPrompts.all;

    const pdfBase64 = pdfBuf.toString("base64");

    let resp: Response;
    try {
      resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: focusPrompt },
                  { inline_data: { mime_type: "application/pdf", data: pdfBase64 } },
                ],
              },
            ],
            generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
          }),
        },
      );
    } catch (e: any) {
      return `analyze_pdf: Gemini network error — ${e.message}`;
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return `analyze_pdf: Gemini ${resp.status} — ${body.slice(0, 300)}`;
    }

    const data = (await resp.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text.trim()) return "analyze_pdf: vision returned empty response.";

    return text.trim();
  }
}
