import { Tool, ToolDefinition } from "../../types";
import { YoutubeTranscript } from "youtube-transcript";

export class YoutubeTranscriptTool implements Tool {
  definition: ToolDefinition = {
    name: "youtube_get_transcript",
    description: "Fetch the transcript of a YouTube video by its URL. Use this to analyze daily uploads for frequency alignment briefs.",
    parameters: {
      url: { type: "string", description: "The full YouTube video URL." },
    },
    required: ["url"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const url = String(args.url || "").trim();
    if (!url) return "youtube_get_transcript: url required.";

    try {
      const transcript = await YoutubeTranscript.fetchTranscript(url);
      if (!transcript || transcript.length === 0) {
        return `⬚ No transcript found for video: ${url}`;
      }

      // Combine text segments
      const text = transcript.map(t => t.text).join(" ");
      return text.slice(0, 15000); // Caps to avoid context overflow
    } catch (err: any) {
      return `❌ YouTube Transcript error: ${err.message}`;
    }
  }
}
