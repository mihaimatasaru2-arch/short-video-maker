/* eslint-disable @remotion/deterministic-randomness */
import fs from "fs-extra";
import path from "path";
import { logger } from "../../logger";
import { SAFE_FILENAME_REGEX } from "../../types/shorts";

export const BACKGROUND_VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov"];
export const BACKGROUND_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

export type LocalBackground = {
  file: string;
  kind: "video" | "image";
};

/**
 * Picks background clips/photos from a local folder instead of Pexels.
 * The scene's searchTerms are matched against the words in each file name,
 * e.g. "nebula-purple-galaxy.mp4" matches "nebula" and "galaxy".
 */
export class LocalBackgrounds {
  constructor(private dirPath: string) {}

  public list(): LocalBackground[] {
    if (!fs.existsSync(this.dirPath)) {
      return [];
    }
    return fs
      .readdirSync(this.dirPath)
      .filter((file) => SAFE_FILENAME_REGEX.test(file) && !file.startsWith("."))
      .map((file): LocalBackground | null => {
        const ext = path.extname(file).toLowerCase();
        if (BACKGROUND_VIDEO_EXTENSIONS.includes(ext)) return { file, kind: "video" };
        if (BACKGROUND_IMAGE_EXTENSIONS.includes(ext)) return { file, kind: "image" };
        return null;
      })
      .filter((b): b is LocalBackground => b !== null);
  }

  public hasAny(): boolean {
    return this.list().length > 0;
  }

  /** Like find(), but returns null unless at least one search term matches a file name. */
  public findMatch(searchTerms: string[], excludeFiles: string[]): LocalBackground | null {
    if (!this.hasAny()) return null;
    const pick = this.find(searchTerms, excludeFiles);
    const words = path.parse(pick.file).name.toLowerCase().split(/[^a-z0-9]+/);
    const matched = searchTerms.some((t) => words.includes(t.toLowerCase().trim()));
    return matched ? pick : null;
  }

  public find(searchTerms: string[], excludeFiles: string[]): LocalBackground {
    const all = this.list();
    if (all.length === 0) {
      throw new Error(`No background videos or images found in ${this.dirPath}`);
    }

    const terms = searchTerms.map((t) => t.toLowerCase().trim()).filter(Boolean);
    const score = (b: LocalBackground) => {
      const words = path
        .parse(b.file)
        .name.toLowerCase()
        .split(/[^a-z0-9]+/);
      return terms.filter((t) => words.includes(t)).length;
    };

    // prefer files not used yet in this video; reuse only when we run out
    const fresh = all.filter((b) => !excludeFiles.includes(b.file));
    const pool = fresh.length > 0 ? fresh : all;

    const best = Math.max(...pool.map(score));
    const candidates = pool.filter((b) => score(b) === best);
    const pick = candidates[Math.floor(Math.random() * candidates.length)];

    logger.debug({ searchTerms, pick, matchedTerms: best }, "Picked local background");
    return pick;
  }
}
