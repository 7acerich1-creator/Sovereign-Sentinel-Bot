// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Dynamic Kinetic Caption Engine
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Groq Whisper (word-level timestamps) → Advanced SubStation Alpha (.ass)
//
// Purpose: burn bold, centered, Bebas Neue kinetic captions into the
// faceless video so it reads at a glance with audio off. The static
// drawtext hook is insufficient — nobody watches uncaptioned Shorts.
//
// Input:   path to the composite narration audio (Adam Brooding TTS)
// Output:  an .ass file ready to be wired via ffmpeg's subtitles filter
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, writeFileSync, existsSync } from "fs";
import { config } from "../config";

// ── Types ───────────────────────────────────────────────────────────
export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

export interface CaptionChunk {
  text: string;
  start: number;
  end: number;
}

export interface CaptionOptions {
  /** Skip all words whose END time is <= this (seconds). Used to hide captions during the Terminal Override hook. */
  skipUntilSeconds?: number;
  /** Output .ass path. */
  outputPath: string;
  /** Video width in px (must match ffmpeg rendering size for correct positioning). */
  videoWidth: number;
  /** Video height in px. */
  videoHeight: number;
  /** Max words per caption chunk. Default 3 for kinetic feel. */
  maxWordsPerChunk?: number;
  /** Max chunk duration before forcing a split (seconds). Default 1.5. */
  maxChunkDuration?: number;
  /** Font name. Default "Bebas Neue". */
  fontName?: string;
  /**
   * Session 47: Uniform time offset (seconds) applied to every chunk AFTER
   * skipUntilSeconds filtering. Used when the audio track that was whisper'd
   * gets adelayed in the final mix (e.g. brand intro pre-shift on long-form
   * horizontals). Defaults to 0 (legacy behavior — no shift).
   */
  timeOffsetSeconds?: number;
  /**
   * Session 48 Brand Routing Matrix: when set, the caption engine switches its
   * visual grammar (font, BorderStyle, casing, shadow) to match the brand.
   *   - "containment_field" → Bebas Neue, uppercase, BorderStyle 3 opaque box (current look)
   *   - "sovereign_synthesis"        → Montserrat, mixed case, BorderStyle 1 soft outline + shadow
   * If unset, defaults to the legacy TCF look so existing callers don't regress.
   */
  brand?: "sovereign_synthesis" | "containment_field";
}

export interface CaptionResult {
  assPath: string;
  chunkCount: number;
  wordCount: number;
  firstWordStart: number;
  lastWordEnd: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WHISPER — request word-level timestamps from Groq
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Transcribes an audio file via Groq Whisper with word-level timestamps.
 * Groq supports `timestamp_granularities[]=word` on whisper-large-v3.
 * (whisper-large-v3-turbo does NOT support word-level — we upgrade to v3 here.)
 */
export async function whisperWords(audioPath: string): Promise<WhisperWord[]> {
  if (!existsSync(audioPath)) {
    throw new Error(`whisperWords: audio file not found: ${audioPath}`);
  }

  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = config.voice.whisperApiKey;

  if (!groqKey && !openaiKey) {
    throw new Error("whisperWords: no Whisper API key (set GROQ_API_KEY or OPENAI_API_KEY)");
  }

  const audioBuffer = readFileSync(audioPath);
  const fileSizeMB = audioBuffer.length / (1024 * 1024);
  if (fileSizeMB > 25) {
    throw new Error(
      `whisperWords: audio file too large (${fileSizeMB.toFixed(1)}MB, Whisper limit 25MB)`
    );
  }

  // Prefer Groq — free, fast, supports word-level on whisper-large-v3.
  const boundary = `----CaptionBoundary${Date.now()}`;
  const header = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="narration.mp3"\r\n` +
      `Content-Type: audio/mpeg\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);

  function field(name: string, value: string): Buffer {
    return Buffer.from(
      `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
        value
    );
  }

  // Word-level granularity requires repeating the key twice:
  //   timestamp_granularities[]=segment  (default)
  //   timestamp_granularities[]=word
  // We send both so whichever provider we land on gets usable data.
  const primary = groqKey
    ? {
        endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
        model: "whisper-large-v3", // v3 (not turbo) — word-level support
        key: groqKey,
        label: "Groq",
      }
    : {
        endpoint: "https://api.openai.com/v1/audio/transcriptions",
        model: "whisper-1",
        key: openaiKey!,
        label: "OpenAI",
      };

  const body = Buffer.concat([
    header,
    audioBuffer,
    field("model", primary.model),
    field("response_format", "verbose_json"),
    field("language", "en"),
    field("timestamp_granularities[]", "segment"),
    field("timestamp_granularities[]", "word"),
    footer,
  ]);

  console.log(`🗣️ [CaptionEngine] Transcribing via ${primary.label} (${primary.model}) for word-level timestamps...`);

  let resp = await fetch(primary.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${primary.key}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  // Fallback: Groq failed, try OpenAI
  if (!resp.ok && primary.label === "Groq" && openaiKey) {
    console.warn(`[CaptionEngine] Groq failed (${resp.status}), falling back to OpenAI whisper-1`);
    const oaiBody = Buffer.concat([
      header,
      audioBuffer,
      field("model", "whisper-1"),
      field("response_format", "verbose_json"),
      field("language", "en"),
      field("timestamp_granularities[]", "segment"),
      field("timestamp_granularities[]", "word"),
      footer,
    ]);
    resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: oaiBody,
    });
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Whisper error ${resp.status}: ${errText.slice(0, 400)}`);
  }

  const raw: any = await resp.json();

  // Extract word-level timestamps. Both Groq and OpenAI return `words: [{word, start, end}]`
  // when timestamp_granularities[]=word is set.
  let words: WhisperWord[] = [];
  if (Array.isArray(raw.words) && raw.words.length > 0) {
    words = raw.words.map((w: any) => ({
      word: String(w.word || "").trim(),
      start: Number(w.start) || 0,
      end: Number(w.end) || 0,
    }));
  } else if (Array.isArray(raw.segments)) {
    // Fallback: if no word array, synthesize words from segment text with
    // linear time interpolation across each segment. Better than nothing.
    console.warn(
      "[CaptionEngine] No word-level timestamps in response. Interpolating from segments."
    );
    for (const seg of raw.segments) {
      const text = String(seg.text || "").trim();
      if (!text) continue;
      const tokens = text.split(/\s+/).filter(Boolean);
      const segStart = Number(seg.start) || 0;
      const segEnd = Number(seg.end) || segStart;
      const segDur = Math.max(0.1, segEnd - segStart);
      const perWord = segDur / tokens.length;
      for (let i = 0; i < tokens.length; i++) {
        words.push({
          word: tokens[i],
          start: segStart + i * perWord,
          end: segStart + (i + 1) * perWord,
        });
      }
    }
  }

  // Sanitize: drop empties, enforce monotonic, clamp negatives
  words = words
    .filter((w) => w.word && w.end > w.start)
    .map((w) => ({
      word: w.word.replace(/[\r\n]/g, " ").trim(),
      start: Math.max(0, w.start),
      end: Math.max(0, w.end),
    }));

  console.log(`✅ [CaptionEngine] ${words.length} word timestamps extracted`);
  return words;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHUNKER — group words into tight 2-4-word kinetic bursts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function chunkWords(
  words: WhisperWord[],
  opts: { maxWordsPerChunk: number; maxChunkDuration: number; skipUntilSeconds: number }
): CaptionChunk[] {
  const chunks: CaptionChunk[] = [];
  let current: WhisperWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const start = current[0].start;
    const end = current[current.length - 1].end;
    const text = current.map((w) => w.word).join(" ");
    chunks.push({ text, start, end });
    current = [];
  };

  for (const w of words) {
    // Skip everything that ends before the Terminal Override hook is over.
    if (w.end <= opts.skipUntilSeconds) continue;

    // If the current word starts during the skip window but extends past it,
    // push its start forward to the skip boundary so the caption doesn't
    // flash during the typewriter reveal.
    const adjusted: WhisperWord = {
      ...w,
      start: Math.max(w.start, opts.skipUntilSeconds),
    };

    if (current.length === 0) {
      current.push(adjusted);
      continue;
    }

    const chunkStart = current[0].start;
    const prospectiveEnd = adjusted.end;
    const prospectiveDur = prospectiveEnd - chunkStart;

    // Split if: chunk is full, duration cap hit, or a sentence terminator is present
    const prevWord = current[current.length - 1].word;
    const hasTerminator = /[.!?]$/.test(prevWord);

    if (
      current.length >= opts.maxWordsPerChunk ||
      prospectiveDur > opts.maxChunkDuration ||
      hasTerminator
    ) {
      flush();
    }

    current.push(adjusted);
  }

  flush();

  // Defensive: ensure chunks don't overlap (nudge starts forward if needed)
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i].start < chunks[i - 1].end) {
      chunks[i].start = chunks[i - 1].end + 0.01;
      if (chunks[i].end <= chunks[i].start) {
        chunks[i].end = chunks[i].start + 0.3;
      }
    }
  }

  return chunks;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ASS WRITER — emit an Advanced SubStation Alpha file
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Format seconds as H:MM:SS.cc (ASS uses centiseconds).
 */
function assTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds - Math.floor(seconds)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/**
 * Escape text for ASS dialogue lines. ASS uses `\N` for line breaks,
 * `{` and `}` for override tags, and backslashes are literal otherwise.
 */
function assEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\r?\n/g, "\\N");
}

export function writeAssFile(chunks: CaptionChunk[], opts: CaptionOptions): string {
  // ── Session 48 Brand Routing Matrix ─────────────────────────────────────────
  // Two distinct caption aesthetics:
  //   TCF   → Bebas Neue display caps, BorderStyle 3 OPAQUE BOX plate (current).
  //           Reads like surveillance-footage chyron. High-stakes corporate noir.
  //   SS   → Montserrat semi-bold mixed-case, BorderStyle 1 soft outline + drop
  //           shadow. Reads like elegant cosmic transmission. No box plate — the
  //           luminous quantum background stays visible.
  // The `brand` option drives every downstream knob: fontName, casing, border
  // geometry, back-color alpha. Unset → legacy TCF look (no regression).
  const isSS = opts.brand === "sovereign_synthesis";
  const defaultFont = isSS ? "Montserrat" : "Bebas Neue";
  const fontName = opts.fontName || defaultFont;

  // Kinetic caption style (Session 47/48 — Brand Routing Matrix):
  //   TCF: BorderStyle 3 OPAQUE BOX, Bold -1, uppercase, heavy dark plate.
  //   SS: BorderStyle 1 outline+shadow, lighter weight, mixed case, translucent back.
  //
  //   - Alignment 2 = bottom-center. MarginV lifts it off the absolute bottom.
  //   - Font size scales with video height (vertical Shorts need bigger text).
  //   - Spacing +2 for Bebas tracking; 0 for Montserrat (already has tracking).
  const isVertical = opts.videoHeight > opts.videoWidth;
  const fontSize = isVertical ? 104 : 78;
  const marginV = isVertical ? Math.round(opts.videoHeight * 0.22) : Math.round(opts.videoHeight * 0.12);

  // ASS colors are &HAABBGGRR (alpha, blue, green, red) — alpha is INVERTED (00=opaque, FF=transparent).
  const PRIMARY = "&H00FFFFFF"; // white fill, fully opaque
  const SECONDARY = "&H000000FF"; // unused (karaoke)
  const OUTLINE_TCF = "&H00000000"; // opaque black — box bleed for BorderStyle 3
  const OUTLINE_SS = "&H00000000"; // thin opaque black outline for legibility
  const BACK_TCF = "&H50000000"; // ~69% opaque black plate
  const BACK_SS = "&HFF000000"; // fully transparent — NO plate, luminous bg survives

  // Brand-routed style parameters:
  //   borderStyle: 3 = opaque box (TCF), 1 = outline+shadow (SS)
  //   outline: thickness of the border/box bleed
  //   shadow: drop shadow distance (only visible under BorderStyle 1)
  //   bold: -1 = full bold for Bebas display face; 0 = regular for Montserrat (semi-bold is already bold in the TTF)
  //   spacing: 2 = extra tracking for Bebas, 0 = natural for Montserrat
  const borderStyle = isSS ? 1 : 3;
  const outline     = isSS ? 2 : 4;
  const shadow      = isSS ? 3 : 0;
  const bold        = isSS ? -1 : -1; // semi-bold montserrat still benefits from -1 synth-bold
  const spacing     = isSS ? 0 : 2;
  const outlineColor = isSS ? OUTLINE_SS : OUTLINE_TCF;
  const backColor    = isSS ? BACK_SS : BACK_TCF;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${opts.videoWidth}
PlayResY: ${opts.videoHeight}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Kinetic,${fontName},${fontSize},${PRIMARY},${SECONDARY},${outlineColor},${backColor},${bold},0,0,0,100,100,${spacing},0,${borderStyle},${outline},${shadow},2,60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines: string[] = [];
  for (const chunk of chunks) {
    // Brand-routed casing:
    //   TCF uppercase → Bebas Neue display caps (corporate noir chyron)
    //   SS mixed case → Montserrat elegant sentence case (cosmic transmission)
    const textBody = isSS ? chunk.text : chunk.text.toUpperCase();
    const escaped = assEscape(textBody);
    // Visible pop-in: scale 85% → 100% over the first 150ms.
    // SS adds a subtle blur fade-in for the ethereal cosmic feel; TCF keeps the hard snap.
    const popIn = isSS
      ? `{\\blur1\\fscx90\\fscy90\\t(0,180,\\blur0\\fscx100\\fscy100)}`
      : `{\\fscx85\\fscy85\\t(0,150,\\fscx100\\fscy100)}`;
    lines.push(
      `Dialogue: 0,${assTime(chunk.start)},${assTime(chunk.end)},Kinetic,,0,0,0,,${popIn}${escaped}`
    );
  }

  const ass = header + lines.join("\n") + "\n";
  writeFileSync(opts.outputPath, ass, "utf-8");
  return opts.outputPath;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOP-LEVEL — audio in, .ass out
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * End-to-end: transcribe an audio file with word-level timestamps and emit
 * a styled .ass subtitle file ready for ffmpeg's subtitles filter.
 */
export async function generateCaptionsFromAudio(
  audioPath: string,
  opts: CaptionOptions
): Promise<CaptionResult> {
  const words = await whisperWords(audioPath);
  if (words.length === 0) {
    throw new Error("generateCaptionsFromAudio: Whisper returned no words");
  }

  const chunks = chunkWords(words, {
    maxWordsPerChunk: opts.maxWordsPerChunk ?? 3,
    maxChunkDuration: opts.maxChunkDuration ?? 1.5,
    skipUntilSeconds: opts.skipUntilSeconds ?? 0,
  });

  // Session 47: shift every chunk by timeOffsetSeconds so captions align with the
  // final muxed audio when upstream adelay was applied (brand intro pre-shift).
  const offset = opts.timeOffsetSeconds ?? 0;
  if (offset > 0) {
    for (const c of chunks) {
      c.start += offset;
      c.end += offset;
    }
  }

  writeAssFile(chunks, opts);

  console.log(
    `🎬 [CaptionEngine] Wrote ${chunks.length} kinetic caption chunks → ${opts.outputPath}`
  );

  return {
    assPath: opts.outputPath,
    chunkCount: chunks.length,
    wordCount: words.length,
    firstWordStart: words[0].start,
    lastWordEnd: words[words.length - 1].end,
  };
}
