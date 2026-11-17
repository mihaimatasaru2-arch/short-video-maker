import { OrientationEnum } from "./../types/shorts";
/* eslint-disable @remotion/deterministic-randomness */
import fs from "fs-extra";
import cuid from "cuid";
import path from "path";
import https from "https";
import http from "http";

import { Kokoro } from "./libraries/Kokoro";
import { Remotion } from "./libraries/Remotion";
import { Whisper } from "./libraries/Whisper";
import { FFMpeg } from "./libraries/FFmpeg";
import { PexelsAPI } from "./libraries/Pexels";
import { LocalBackgrounds } from "./libraries/LocalBackgrounds";
import { PixabayAPI } from "./libraries/Pixabay";
import { ElevenLabs } from "./libraries/ElevenLabs";
import { Config } from "../config";
import { logger } from "../logger";
import { MusicManager } from "./music";
import type {
  SceneInput,
  RenderConfig,
  Scene,
  VideoStatus,
  MusicMoodEnum,
  MusicTag,
  MusicForVideo,
  OverlayInput,
  SceneOverlay,
  Video,
  Voices,
} from "../types/shorts";

export class ShortCreator {
  private queue: {
    sceneInput: SceneInput[];
    config: RenderConfig;
    id: string;
  }[] = [];
  constructor(
    private config: Config,
    private remotion: Remotion,
    private kokoro: Kokoro,
    private whisper: Whisper,
    private ffmpeg: FFMpeg,
    private pexelsApi: PexelsAPI,
    private musicManager: MusicManager,
  ) {
    this.localBackgrounds = new LocalBackgrounds(config.backgroundsDirPath);
    this.pixabayApi = new PixabayAPI(config.pixabayApiKey);
    this.elevenLabs = new ElevenLabs(config.elevenLabsApiKey);
  }
  private elevenLabs: ElevenLabs;
  private localBackgrounds: LocalBackgrounds;
  private pixabayApi: PixabayAPI;

  public status(id: string): VideoStatus {
    const videoPath = this.getVideoPath(id);
    if (this.queue.find((item) => item.id === id)) {
      return "processing";
    }
    if (fs.existsSync(videoPath)) {
      return "ready";
    }
    return "failed";
  }

  public addToQueue(sceneInput: SceneInput[], config: RenderConfig): string {
    // fail fast with a clear message if an overlay file is missing
    this.validateOverlayFiles(sceneInput);
    if (ElevenLabs.isElevenLabsVoice(config.voice) && !this.elevenLabs.isConfigured()) {
      throw new Error(
        `Voice "${config.voice}" needs ELEVENLABS_API_KEY - add it with the start script`,
      );
    }
    // todo add mutex lock
    const id = cuid();
    this.queue.push({
      sceneInput,
      config,
      id,
    });
    if (this.queue.length === 1) {
      this.processQueue();
    }
    return id;
  }

  private async processQueue(): Promise<void> {
    // todo add a semaphore
    if (this.queue.length === 0) {
      return;
    }
    const { sceneInput, config, id } = this.queue[0];
    logger.debug(
      { sceneInput, config, id },
      "Processing video item in the queue",
    );
    try {
      await this.createShort(id, sceneInput, config);
      logger.debug({ id }, "Video created successfully");
    } catch (error: unknown) {
      logger.error(error, "Error creating video");
    } finally {
      this.queue.shift();
      this.processQueue();
    }
  }

  private async createShort(
    videoId: string,
    inputScenes: SceneInput[],
    config: RenderConfig,
  ): Promise<string> {
    logger.debug(
      {
        inputScenes,
        config,
      },
      "Creating short video",
    );
    const scenes: Scene[] = [];
    let totalDuration = 0;
    const excludeVideoIds = [];
    const tempFiles = [];

    const orientation: OrientationEnum =
      config.orientation || OrientationEnum.portrait;

    let index = 0;
    for (const scene of inputScenes) {
      const voice = config.voice ?? "af_heart";
      const audio = ElevenLabs.isElevenLabsVoice(voice)
        ? await this.elevenLabs.generate(scene.text, voice, config.voiceSettings, {
            previousText: inputScenes[index - 1]?.text,
            nextText: inputScenes[index + 1]?.text,
          })
        : await this.kokoro.generate(scene.text, voice as Voices);
      let { audioLength } = audio;
      const { audio: audioStream } = audio;

      // add the paddingBack in seconds to the last scene
      if (index + 1 === inputScenes.length && config.paddingBack) {
        audioLength += config.paddingBack / 1000;
      }

      const tempId = cuid();
      const tempWavFileName = `${tempId}.wav`;
      const tempMp3FileName = `${tempId}.mp3`;
      const tempVideoFileName = `${tempId}.mp4`;
      const tempWavPath = path.join(this.config.tempDirPath, tempWavFileName);
      const tempMp3Path = path.join(this.config.tempDirPath, tempMp3FileName);
      const tempVideoPath = path.join(
        this.config.tempDirPath,
        tempVideoFileName,
      );
      tempFiles.push(tempVideoPath);
      tempFiles.push(tempWavPath, tempMp3Path);

      await this.ffmpeg.saveNormalizedAudio(audioStream, tempWavPath);
      const captions = await this.whisper.CreateCaption(tempWavPath);

      await this.ffmpeg.saveToMp3(audioStream, tempMp3Path);

      // Background priority:
      // 1) your own file whose name matches a search term
      // 2) Pixabay (if PIXABAY_API_KEY is set)
      // 3) Pexels (if PEXELS_API_KEY is set)
      // 4) any file from your backgrounds folder
      let bg = this.localBackgrounds.findMatch(scene.searchTerms, excludeVideoIds);
      let video: Video | null = null;
      let fromPixabay = false;
      if (!bg && this.pixabayApi.isConfigured()) {
        try {
          video = await this.pixabayApi.findVideo(
            scene.searchTerms,
            audioLength,
            excludeVideoIds,
            orientation,
          );
          fromPixabay = true;
        } catch (error: unknown) {
          if (!this.localBackgrounds.hasAny() && !this.config.pexelsApiKey) {
            throw error;
          }
          logger.warn(error, "Pixabay failed, falling back");
        }
      }
      if (!bg && !video && !this.config.pexelsApiKey && this.localBackgrounds.hasAny()) {
        bg = this.localBackgrounds.find(scene.searchTerms, excludeVideoIds);
      }

      if (bg) {
        excludeVideoIds.push(bg.file);
        scenes.push({
          captions,
          video: `http://localhost:${this.config.port}/backgrounds/${encodeURIComponent(bg.file)}`,
          background: { kind: bg.kind },
          audio: {
            url: `http://localhost:${this.config.port}/api/tmp/${tempMp3FileName}`,
            duration: audioLength,
          },
          ...(scene.overlays?.length
            ? { overlays: scene.overlays.map((o) => this.toSceneOverlay(o)) }
            : {}),
        });
        totalDuration += audioLength;
        index++;
        continue;
      }

      if (!video) {
        video = await this.pexelsApi.findVideo(
          scene.searchTerms,
          audioLength,
          excludeVideoIds,
          orientation,
        );
      }
      const videoUrl = video.url;

      logger.debug(`Downloading video from ${video.url} to ${tempVideoPath}`);

      await new Promise<void>((resolve, reject) => {
        const fileStream = fs.createWriteStream(tempVideoPath);
        https
          .get(videoUrl, (response: http.IncomingMessage) => {
            if (response.statusCode !== 200) {
              reject(
                new Error(`Failed to download video: ${response.statusCode}`),
              );
              return;
            }

            response.pipe(fileStream);

            fileStream.on("finish", () => {
              fileStream.close();
              logger.debug(`Video downloaded successfully to ${tempVideoPath}`);
              resolve();
            });
          })
          .on("error", (err: Error) => {
            fs.unlink(tempVideoPath, () => {}); // Delete the file if download failed
            logger.error(err, "Error downloading video:");
            reject(err);
          });
      });

      excludeVideoIds.push(video.id);

      scenes.push({
        captions,
        video: `http://localhost:${this.config.port}/api/tmp/${tempVideoFileName}`,
        // Pixabay clips are often landscape: crop to fill and loop if short
        ...(fromPixabay ? { background: { kind: "video" as const } } : {}),
        audio: {
          url: `http://localhost:${this.config.port}/api/tmp/${tempMp3FileName}`,
          duration: audioLength,
        },
        // only add the key when there are overlays, so normal scenes are unchanged
        ...(scene.overlays?.length
          ? { overlays: scene.overlays.map((o) => this.toSceneOverlay(o)) }
          : {}),
      });

      totalDuration += audioLength;
      index++;
    }
    if (config.paddingBack) {
      totalDuration += config.paddingBack / 1000;
    }

    const selectedMusic = this.findMusic(totalDuration, config.music);
    logger.debug({ selectedMusic }, "Selected music for the video");

    await this.remotion.render(
      {
        music: selectedMusic,
        scenes,
        config: {
          durationMs: totalDuration * 1000,
          paddingBack: config.paddingBack,
          ...{
            captionBackgroundColor: config.captionBackgroundColor,
            captionPosition: config.captionPosition,
          },
          musicVolume: config.musicVolume,
        },
      },
      videoId,
      orientation,
    );

    for (const file of tempFiles) {
      fs.removeSync(file);
    }

    return videoId;
  }

  private validateOverlayFiles(inputScenes: SceneInput[]): void {
    const missing: string[] = [];
    inputScenes.forEach((scene, i) => {
      scene.overlays?.forEach((overlay, j) => {
        const where = `scenes[${i}].overlays[${j}]`;
        const imagePath = path.join(this.config.overlaysDirPath, overlay.image);
        if (!fs.existsSync(imagePath)) {
          missing.push(`${where}.image "${overlay.image}" not found in overlays folder`);
        }
        if (overlay.sound) {
          const soundPath = path.join(this.config.soundsDirPath, overlay.sound);
          if (!fs.existsSync(soundPath)) {
            missing.push(`${where}.sound "${overlay.sound}" not found in sounds folder`);
          }
        }
      });
    });
    if (missing.length > 0) {
      throw new Error(`Missing overlay files: ${missing.join("; ")}`);
    }
  }

  private toSceneOverlay(overlay: OverlayInput): SceneOverlay {
    const base = `http://localhost:${this.config.port}`;
    return {
      imageUrl: `${base}/overlays/${encodeURIComponent(overlay.image)}`,
      atSec: overlay.atSec,
      durationSec: overlay.durationSec,
      position: overlay.position,
      animation: overlay.animation,
      scale: overlay.scale,
      outline: overlay.outline,
      soundUrl: overlay.sound
        ? `${base}/sounds/${encodeURIComponent(overlay.sound)}`
        : undefined,
      soundVolume: overlay.soundVolume,
    };
  }

  public getVideoPath(videoId: string): string {
    return path.join(this.config.videosDirPath, `${videoId}.mp4`);
  }

  public deleteVideo(videoId: string): void {
    const videoPath = this.getVideoPath(videoId);
    fs.removeSync(videoPath);
    logger.debug({ videoId }, "Deleted video file");
  }

  public getVideo(videoId: string): Buffer {
    const videoPath = this.getVideoPath(videoId);
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video ${videoId} not found`);
    }
    return fs.readFileSync(videoPath);
  }

  private findMusic(videoDuration: number, tag?: MusicMoodEnum): MusicForVideo {
    const musicFiles = this.musicManager.musicList().filter((music) => {
      if (tag) {
        return music.mood === tag;
      }
      return true;
    });
    return musicFiles[Math.floor(Math.random() * musicFiles.length)];
  }

  public ListAvailableMusicTags(): MusicTag[] {
    const tags = new Set<MusicTag>();
    this.musicManager.musicList().forEach((music) => {
      tags.add(music.mood as MusicTag);
    });
    return Array.from(tags.values());
  }

  public listAllVideos(): { id: string; status: VideoStatus }[] {
    const videos: { id: string; status: VideoStatus }[] = [];

    // Check if videos directory exists
    if (!fs.existsSync(this.config.videosDirPath)) {
      return videos;
    }

    // Read all files in the videos directory
    const files = fs.readdirSync(this.config.videosDirPath);

    // Filter for MP4 files and extract video IDs
    for (const file of files) {
      if (file.endsWith(".mp4")) {
        const videoId = file.replace(".mp4", "");

        let status: VideoStatus = "ready";
        const inQueue = this.queue.find((item) => item.id === videoId);
        if (inQueue) {
          status = "processing";
        }

        videos.push({ id: videoId, status });
      }
    }

    // Add videos that are in the queue but not yet rendered
    for (const queueItem of this.queue) {
      const existingVideo = videos.find((v) => v.id === queueItem.id);
      if (!existingVideo) {
        videos.push({ id: queueItem.id, status: "processing" });
      }
    }

    return videos;
  }

  public ListAvailableVoices(): string[] {
    return this.kokoro.listAvailableVoices();
  }

  /** Kokoro voices plus the ElevenLabs voices in the user's account (if a key is set). */
  public async ListAllVoices(): Promise<{
    kokoro: string[];
    elevenlabs: string[];
    elevenlabsError?: string;
  }> {
    const kokoro = this.kokoro.listAvailableVoices();
    if (!this.elevenLabs.isConfigured()) {
      return { kokoro, elevenlabs: [], elevenlabsError: "ELEVENLABS_API_KEY not set" };
    }
    try {
      const voices = await this.elevenLabs.listVoices();
      return { kokoro, elevenlabs: voices.map((v) => `elevenlabs:${v.name}`) };
    } catch (error: unknown) {
      return {
        kokoro,
        elevenlabs: [],
        elevenlabsError: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
