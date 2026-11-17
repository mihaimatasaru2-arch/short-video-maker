/* eslint-disable @remotion/deterministic-randomness */
import { getOrientationConfig } from "../../components/utils";
import { logger } from "../../logger";
import { OrientationEnum, type Video } from "../../types/shorts";

// Pixabay API docs: https://pixabay.com/api/docs/
// - videos have no orientation filter, so we rank by shape and crop to fill the frame
// - results must be cached for 24 hours; limit is 100 requests / 60 s

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10000;
const SIZES = ["tiny", "small", "medium", "large"] as const;

type PixabayRendition = {
  url: string;
  width: number;
  height: number;
  size: number;
};

type PixabayHit = {
  id: number;
  pageURL: string;
  tags: string;
  duration: number;
  user: string;
  videos: Partial<Record<(typeof SIZES)[number], PixabayRendition>>;
};

export class PixabayAPI {
  private cache = new Map<string, { at: number; hits: PixabayHit[] }>();

  constructor(private apiKey: string | undefined) {}

  public isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private async search(term: string): Promise<PixabayHit[]> {
    const cacheKey = term.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.hits;
    }

    const params = new URLSearchParams({
      key: this.apiKey as string,
      q: term.slice(0, 100),
      video_type: "all",
      safesearch: "true",
      per_page: "50",
    });
    const res = await fetch(`https://pixabay.com/api/videos/?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // error bodies are plain text, e.g. "API rate limit exceeded" (429)
      const body = (await res.text()).slice(0, 200);
      if (res.status === 400 && /key/i.test(body)) {
        throw new Error("Invalid Pixabay API key - check PIXABAY_API_KEY");
      }
      throw new Error(`Pixabay API error ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { hits?: PixabayHit[] };
    const hits = data.hits ?? [];
    this.cache.set(cacheKey, { at: Date.now(), hits });
    return hits;
  }

  /**
   * Smallest rendition that still covers the target frame after cropping
   * (so it stays sharp), else the largest one available.
   */
  private pickRendition(
    hit: PixabayHit,
    targetW: number,
    targetH: number,
  ): PixabayRendition | null {
    const renditions = SIZES.map((s) => hit.videos[s]).filter(
      (r): r is PixabayRendition => Boolean(r && r.url && r.width && r.height),
    );
    if (renditions.length === 0) return null;
    const coverScale = (r: PixabayRendition) =>
      Math.max(targetW / r.width, targetH / r.height); // >1 means upscaling
    const sharp = renditions.filter((r) => coverScale(r) <= 1.05);
    if (sharp.length > 0) {
      return sharp.reduce((a, b) => (a.size <= b.size ? a : b));
    }
    return renditions.reduce((a, b) => (coverScale(a) <= coverScale(b) ? a : b));
  }

  private async findForTerm(
    term: string,
    minDurationSeconds: number,
    excludeIds: string[],
    orientation: OrientationEnum,
  ): Promise<Video | null> {
    const { width: targetW, height: targetH } = getOrientationConfig(orientation);
    const wantPortrait = targetH > targetW;
    const hits = await this.search(term);

    const candidates = hits
      .filter((h) => !excludeIds.includes(`pixabay-${h.id}`))
      .map((h) => {
        const r = this.pickRendition(h, targetW, targetH);
        if (!r) return null;
        const isPortrait = r.height > r.width;
        let score = 0;
        if (isPortrait === wantPortrait) score += 4; // right shape, no big crop
        if (h.duration >= minDurationSeconds) score += 2; // no looping needed
        if (Math.max(targetW / r.width, targetH / r.height) <= 1.05) score += 1; // sharp
        return { h, r, score };
      })
      .filter((c): c is { h: PixabayHit; r: PixabayRendition; score: number } => c !== null);

    if (candidates.length === 0) return null;
    const best = Math.max(...candidates.map((c) => c.score));
    const top = candidates.filter((c) => c.score === best).slice(0, 10);
    const { h, r } = top[Math.floor(Math.random() * top.length)];

    logger.info(
      { term, pixabayId: h.id, by: h.user, page: h.pageURL, size: `${r.width}x${r.height}` },
      "Picked Pixabay video (credit: Pixabay)",
    );
    return { id: `pixabay-${h.id}`, url: r.url, width: r.width, height: r.height };
  }

  async findVideo(
    searchTerms: string[],
    minDurationSeconds: number,
    excludeIds: string[],
    orientation: OrientationEnum,
  ): Promise<Video> {
    const terms = [...searchTerms].sort(() => Math.random() - 0.5);
    for (const term of [...terms, "space", "galaxy"]) {
      try {
        const video = await this.findForTerm(term, minDurationSeconds, excludeIds, orientation);
        if (video) return video;
      } catch (error: unknown) {
        logger.error(error, "Pixabay search failed");
        if (error instanceof Error && /Invalid Pixabay API key/.test(error.message)) {
          throw error;
        }
      }
    }
    throw new Error(`No Pixabay videos found for: ${searchTerms.join(", ")}`);
  }
}
