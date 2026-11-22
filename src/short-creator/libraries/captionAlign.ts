import type { Caption } from "../../types/shorts";

// Makes captions show the exact script words while keeping Whisper's timing.
//
// Whisper hears the audio and returns words with times, but it may spell them
// differently ("Doctor" -> "Dr.", "Avengers: Doomsday" -> "Avengers? Doomsday").
// We line up the letters of the script with the letters Whisper heard (longest
// common subsequence), give every script word the time of its matched letters,
// and spread any unmatched words evenly over the gap they sit in.

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Remove things that are spoken instructions, not words: ElevenLabs v3 [tags] and <break /> tags. */
export function cleanScriptText(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function alignCaptionsToScript(
  whisper: Caption[],
  scriptText: string,
  minMatchRatio = 0.4,
): Caption[] {
  const script = cleanScriptText(scriptText);
  if (!script || whisper.length === 0) return whisper;

  // Script words; punctuation-only pieces ("—", "…") are glued to the previous word.
  const words: string[] = [];
  for (const w of script.split(" ")) {
    if (norm(w) === "" && words.length > 0) words[words.length - 1] += ` ${w}`;
    else words.push(w);
  }

  // Letters Whisper heard, each with a time (spread evenly across its token).
  const wChars: string[] = [];
  const wTimes: number[] = [];
  for (const c of whisper) {
    const letters = norm(c.text);
    const dur = Math.max(0, c.endMs - c.startMs);
    for (let i = 0; i < letters.length; i++) {
      wChars.push(letters[i]);
      wTimes.push(c.startMs + (dur * (i + 0.5)) / letters.length);
    }
  }

  // Script letters, remembering which word each belongs to.
  const sChars: string[] = [];
  const sWord: number[] = [];
  words.forEach((w, wi) => {
    for (const ch of norm(w)) {
      sChars.push(ch);
      sWord.push(wi);
    }
  });
  if (sChars.length === 0 || wChars.length === 0) return whisper;

  // Longest common subsequence of letters.
  const n = sChars.length;
  const m = wChars.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        sChars[i] === wChars[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  if (dp[0][0] / n < minMatchRatio) {
    // The audio doesn't match the script well (e.g. different text was spoken): keep Whisper.
    return whisper;
  }

  const first: (number | undefined)[] = new Array(words.length);
  const last: (number | undefined)[] = new Array(words.length);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (sChars[i] === wChars[j]) {
      const wi = sWord[i];
      if (first[wi] === undefined) first[wi] = wTimes[j];
      last[wi] = wTimes[j];
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }

  // Word boundaries: matched words get their letter times; unmatched runs are
  // spread evenly between the neighbouring matched words (or the audio edges).
  const audioStart = whisper[0].startMs;
  const audioEnd = whisper[whisper.length - 1].endMs;
  const start: number[] = new Array(words.length);
  const end: number[] = new Array(words.length);
  let k = 0;
  while (k < words.length) {
    if (first[k] !== undefined) {
      start[k] = first[k]!;
      end[k] = last[k]!;
      k++;
      continue;
    }
    let r = k;
    while (r < words.length && first[r] === undefined) r++;
    const from = k > 0 ? end[k - 1] : audioStart;
    const to = r < words.length ? first[r]! : audioEnd;
    const step = Math.max(0, to - from) / (r - k);
    for (let x = k; x < r; x++) {
      start[x] = from + step * (x - k);
      end[x] = from + step * (x - k + 1);
    }
    k = r;
  }

  // Close small gaps so each word stays lit until the next one starts.
  const out: Caption[] = words.map((text, i) => ({
    text: i === 0 ? text : ` ${text}`,
    startMs: Math.round(start[i]),
    endMs: Math.round(Math.max(end[i], start[i] + 1)),
  }));
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i + 1].startMs < out[i].startMs) out[i + 1].startMs = out[i].startMs;
    if (out[i + 1].startMs - out[i].endMs < 250) out[i].endMs = Math.max(out[i].endMs, out[i + 1].startMs);
  }
  return out;
}
