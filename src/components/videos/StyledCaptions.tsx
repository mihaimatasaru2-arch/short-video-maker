import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadCinzel } from "@remotion/google-fonts/Cinzel";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import type { Caption } from "../../types/shorts";

// Caption looks beyond the original "classic" one (big Barlow words on a colored box).
//
//   cinematic        serif capitals (Cinzel), cream text, the spoken word glows gold
//   cinematic-purple same, the spoken word glows purple
//   cinematic-dim    same chunks, words still to come are dimmed, spoken word gold
//   subtitle         small modern text (Inter), 2 lines, words still to come are dimmed,
//                    the spoken word gets a purple outline
//
// Words are grouped into short chunks that follow the narration: a chunk ends at
// punctuation (, . … ? ! : ;), at a pause, or when it reaches its word/letter limit.

export const CaptionStyles = [
  "classic",
  "cinematic",
  "cinematic-purple",
  "cinematic-dim",
  "subtitle",
] as const;
export type CaptionStyle = (typeof CaptionStyles)[number];

const { fontFamily: cinzel } = loadCinzel("normal", {
  weights: ["700"],
  subsets: ["latin"],
});
const { fontFamily: inter } = loadInter("normal", {
  weights: ["600"],
  subsets: ["latin"],
});

type Word = { text: string; startMs: number; endMs: number };
type Chunk = { words: Word[]; startMs: number; endMs: number };

const PAUSE_MS = 350;
const ENDS_PHRASE = /[,.…?!:;—]$/;

export function makeChunks(
  captions: Caption[],
  maxWords: number,
  maxChars: number,
): Chunk[] {
  const words: Word[] = captions
    .map((c) => ({ text: c.text.trim(), startMs: c.startMs, endMs: c.endMs }))
    .filter((w) => w.text.length > 0);

  const chunks: Chunk[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    chunks.push({ words: cur, startMs: cur[0].startMs, endMs: cur[cur.length - 1].endMs });
    cur = [];
  };

  words.forEach((w, i) => {
    const chars = cur.map((x) => x.text).join(" ").length;
    if (cur.length > 0 && (cur.length >= maxWords || chars + 1 + w.text.length > maxChars)) {
      flush();
    }
    cur.push(w);
    const next = words[i + 1];
    if (ENDS_PHRASE.test(w.text) || (next && next.startMs - w.endMs > PAUSE_MS)) {
      flush();
    }
  });
  flush();

  // each chunk stays on screen until the next one starts (no flicker between chunks)
  for (let i = 0; i < chunks.length; i++) {
    const next = chunks[i + 1];
    chunks[i].endMs = next
      ? Math.max(chunks[i].endMs, next.startMs)
      : chunks[i].endMs + 400;
  }
  return chunks;
}

type Look = {
  fontFamily: string;
  fontSize: number;
  uppercase: boolean;
  letterSpacing: string;
  top: string;
  maxWidth: string;
  lineHeight: number;
  maxWords: number;
  maxChars: number;
  base: string; // spoken / normal words
  upcoming: string | null; // words not spoken yet (null = same as base)
  active: string;
  activeGlow: string;
  shadow: string;
};

const CREAM = "#F4EBDA";
const SHADOW_SERIF =
  "0 3px 6px rgba(0,0,0,0.9), 0 0 22px rgba(0,0,0,0.75)";

const LOOKS: Record<Exclude<CaptionStyle, "classic">, Look> = {
  cinematic: {
    fontFamily: cinzel,
    fontSize: 76,
    uppercase: true,
    letterSpacing: "0.02em",
    top: "63%",
    maxWidth: "86%",
    lineHeight: 1.12,
    maxWords: 4,
    maxChars: 24,
    base: CREAM,
    upcoming: null,
    active: "#F5C56A",
    activeGlow: "0 0 18px rgba(245,180,80,0.85), 0 0 40px rgba(245,160,60,0.45)",
    shadow: SHADOW_SERIF,
  },
  "cinematic-purple": {
    fontFamily: cinzel,
    fontSize: 76,
    uppercase: true,
    letterSpacing: "0.02em",
    top: "63%",
    maxWidth: "86%",
    lineHeight: 1.12,
    maxWords: 4,
    maxChars: 24,
    base: CREAM,
    upcoming: null,
    active: "#D3A8FF",
    activeGlow: "0 0 18px rgba(176,110,255,0.95), 0 0 42px rgba(140,70,255,0.55)",
    shadow: SHADOW_SERIF,
  },
  "cinematic-dim": {
    fontFamily: cinzel,
    fontSize: 76,
    uppercase: true,
    letterSpacing: "0.02em",
    top: "63%",
    maxWidth: "86%",
    lineHeight: 1.12,
    maxWords: 4,
    maxChars: 24,
    base: CREAM,
    upcoming: "rgba(244,235,218,0.38)",
    active: "#F5C56A",
    activeGlow: "0 0 18px rgba(245,180,80,0.85), 0 0 40px rgba(245,160,60,0.45)",
    shadow: SHADOW_SERIF,
  },
  subtitle: {
    fontFamily: inter,
    fontSize: 54,
    uppercase: false,
    letterSpacing: "0",
    top: "70%",
    maxWidth: "84%",
    lineHeight: 1.25,
    maxWords: 8,
    maxChars: 42,
    base: "#FFFFFF",
    upcoming: "rgba(255,255,255,0.45)",
    active: "#FFFFFF",
    // purple outline around the spoken word (8 tight shadows) plus a soft purple glow
    activeGlow: [
      [3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, 2], [2, -2], [-2, -2],
    ]
      .map(([x, y]) => `${x}px ${y}px 0 #9D5CFF`)
      .concat(["0 0 18px rgba(157,92,255,0.8)"])
      .join(", "),
    shadow: "0 2px 4px rgba(0,0,0,0.85), 0 0 16px rgba(0,0,0,0.6)",
  },
};

/** Captions for one scene. Must sit inside the scene's <Sequence> (times are scene-relative). */
export const StyledCaptions: React.FC<{
  captions: Caption[];
  style: Exclude<CaptionStyle, "classic">;
}> = ({ captions, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const look = LOOKS[style];
  const nowMs = (frame / fps) * 1000;

  const chunks = React.useMemo(
    () => makeChunks(captions, look.maxWords, look.maxChars),
    [captions, look.maxWords, look.maxChars],
  );
  const chunk = chunks.find((c) => nowMs >= c.startMs && nowMs < c.endMs);
  if (!chunk) return null;

  // small rise + fade as each chunk appears
  const sinceStart = nowMs - chunk.startMs;
  const opacity = interpolate(sinceStart, [0, 120], [0, 1], { extrapolateRight: "clamp" });
  const lift = interpolate(sinceStart, [0, 160], [14, 0], { extrapolateRight: "clamp" });

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        width: "100%",
        top: look.top,
        transform: `translateY(calc(-50% + ${lift}px))`,
        opacity,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <p
        style={{
          margin: 0,
          maxWidth: look.maxWidth,
          textAlign: "center",
          fontFamily: look.fontFamily,
          fontWeight: style === "subtitle" ? 600 : 700,
          fontSize: look.fontSize,
          lineHeight: look.lineHeight,
          letterSpacing: look.letterSpacing,
          textTransform: look.uppercase ? "uppercase" : "none",
          color: look.base,
          textShadow: look.shadow,
        }}
      >
        {chunk.words.map((w, i) => {
          const spoken = nowMs >= w.startMs;
          const active = spoken && nowMs < w.endMs;
          let color = look.base;
          let textShadow = look.shadow;
          if (!spoken && look.upcoming) color = look.upcoming;
          if (active) {
            color = look.active;
            if (look.activeGlow !== "none") textShadow = `${look.activeGlow}, ${look.shadow}`;
          }
          return (
            <React.Fragment key={i}>
              <span style={{ color, textShadow }}>{w.text}</span>
              {i < chunk.words.length - 1 ? " " : ""}
            </React.Fragment>
          );
        })}
      </p>
    </div>
  );
};
