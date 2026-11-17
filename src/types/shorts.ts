import z from "zod";

export enum MusicMoodEnum {
  sad = "sad",
  melancholic = "melancholic",
  happy = "happy",
  euphoric = "euphoric/high",
  excited = "excited",
  chill = "chill",
  uneasy = "uneasy",
  angry = "angry",
  dark = "dark",
  hopeful = "hopeful",
  contemplative = "contemplative",
  funny = "funny/quirky",
}

export enum CaptionPositionEnum {
  top = "top",
  center = "center",
  bottom = "bottom",
}

export enum OverlayPositionEnum {
  left = "left",
  right = "right",
  center = "center",
  top = "top",
  bottom = "bottom",
}

export enum OverlayAnimationEnum {
  pop = "pop",
  slide = "slide",
  fade = "fade",
}

// Plain file names only: letters, numbers, spaces, dot, dash, underscore.
// No slashes and no "..", so a request can never read outside the folder.
export const SAFE_FILENAME_REGEX = /^(?!.*\.\.)[A-Za-z0-9 _.-]+$/;
export const OVERLAY_IMAGE_EXTENSIONS = [".png", ".webp", ".jpg", ".jpeg", ".gif"];
export const OVERLAY_SOUND_EXTENSIONS = [".mp3", ".wav", ".ogg", ".m4a"];

const hasExtension = (exts: string[]) => (name: string) =>
  exts.some((ext) => name.toLowerCase().endsWith(ext));

export const overlayInput = z.object({
  image: z
    .string()
    .regex(SAFE_FILENAME_REGEX, "Must be a plain file name, no folders")
    .refine(hasExtension(OVERLAY_IMAGE_EXTENSIONS), {
      message: `Image must end with ${OVERLAY_IMAGE_EXTENSIONS.join(", ")}`,
    })
    .describe(
      "File name of an image in the server's overlays folder, e.g. 'doom.png'. Transparent PNG character cut-outs look best. Just the name, no folder path.",
    ),
  atSec: z
    .number()
    .min(0)
    .default(0)
    .describe(
      "When the image appears, in seconds from the START OF THIS SCENE (not the whole video). Default 0. Time it to the moment the narration mentions the character.",
    ),
  durationSec: z
    .number()
    .positive()
    .default(2.5)
    .describe(
      "How long the image stays on screen, in seconds. Default 2.5. It is cut off automatically if the scene ends first.",
    ),
  position: z
    .nativeEnum(OverlayPositionEnum)
    .default(OverlayPositionEnum.center)
    .describe(
      "Where the image sits in the frame: left, right, center, top or bottom. Default center. Captions are always drawn on top of overlays.",
    ),
  animation: z
    .nativeEnum(OverlayAnimationEnum)
    .default(OverlayAnimationEnum.pop)
    .describe(
      "How the image enters: 'pop' = springy scale-in with a slight overshoot (comic style), 'slide' = slides in from the nearest edge, 'fade' = soft fade. All of them fade out at the end. Default pop.",
    ),
  scale: z
    .number()
    .min(0.05)
    .max(1)
    .optional()
    .describe(
      "Image width as a fraction of the frame width, from 0.05 to 1. Default 0.55.",
    ),
  outline: z
    .boolean()
    .optional()
    .describe(
      "Draw a white comic-style outline and drop shadow around the image. Default true.",
    ),
  sound: z
    .string()
    .regex(SAFE_FILENAME_REGEX, "Must be a plain file name, no folders")
    .refine(hasExtension(OVERLAY_SOUND_EXTENSIONS), {
      message: `Sound must end with ${OVERLAY_SOUND_EXTENSIONS.join(", ")}`,
    })
    .optional()
    .describe(
      "Optional sound effect played exactly when the image appears, e.g. 'whoosh.mp3'. File name in the server's sounds folder.",
    ),
  soundVolume: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Volume of the sound effect from 0 to 1. Default 0.5."),
});
export type OverlayInput = z.infer<typeof overlayInput>;

// What the video component receives: file names already turned into URLs.
export type SceneOverlay = {
  imageUrl: string;
  atSec: number;
  durationSec: number;
  position: `${OverlayPositionEnum}`;
  animation: `${OverlayAnimationEnum}`;
  scale?: number;
  outline?: boolean;
  soundUrl?: string;
  soundVolume?: number;
};

export type Scene = {
  captions: Caption[];
  video: string;
  audio: {
    url: string;
    duration: number;
  };
  overlays?: SceneOverlay[];
  // set only for backgrounds from the local folder; Pexels scenes leave it out
  background?: { kind: "video" | "image" };
};

export const sceneInput = z.object({
  text: z.string().describe("Text to be spoken in the video"),
  searchTerms: z
    .array(z.string())
    .describe(
      "Search term for video, 1 word, and at least 2-3 search terms should be provided for each scene. Make sure to match the overall context with the word - regardless what the video search result would be.",
    ),
  overlays: z
    .array(overlayInput)
    .optional()
    .describe(
      "Optional comic character pop-ups shown on top of the background video during this scene (below the captions). Each item is an image from the overlays folder with its own timing, position, animation and optional sound effect. Leave out for a normal scene.",
    ),
});
export type SceneInput = z.infer<typeof sceneInput>;

export enum VoiceEnum {
  af_heart = "af_heart",
  af_alloy = "af_alloy",
  af_aoede = "af_aoede",
  af_bella = "af_bella",
  af_jessica = "af_jessica",
  af_kore = "af_kore",
  af_nicole = "af_nicole",
  af_nova = "af_nova",
  af_river = "af_river",
  af_sarah = "af_sarah",
  af_sky = "af_sky",
  am_adam = "am_adam",
  am_echo = "am_echo",
  am_eric = "am_eric",
  am_fenrir = "am_fenrir",
  am_liam = "am_liam",
  am_michael = "am_michael",
  am_onyx = "am_onyx",
  am_puck = "am_puck",
  am_santa = "am_santa",
  bf_emma = "bf_emma",
  bf_isabella = "bf_isabella",
  bm_george = "bm_george",
  bm_lewis = "bm_lewis",
  bf_alice = "bf_alice",
  bf_lily = "bf_lily",
  bm_daniel = "bm_daniel",
  bm_fable = "bm_fable",
}

export enum OrientationEnum {
  landscape = "landscape",
  portrait = "portrait",
}

export enum MusicVolumeEnum {
  muted = "muted",
  low = "low",
  medium = "medium",
  high = "high",
}

export const renderConfig = z.object({
  paddingBack: z
    .number()
    .optional()
    .describe(
      "For how long the video should be playing after the speech is done, in milliseconds. 1500 is a good value.",
    ),
  music: z
    .nativeEnum(MusicMoodEnum)
    .optional()
    .describe("Music tag to be used to find the right music for the video"),
  captionPosition: z
    .nativeEnum(CaptionPositionEnum)
    .optional()
    .describe("Position of the caption in the video"),
  captionBackgroundColor: z
    .string()
    .optional()
    .describe(
      "Background color of the caption, a valid css color, default is blue",
    ),
  voice: z
    .nativeEnum(VoiceEnum)
    .optional()
    .describe("Voice to be used for the speech, default is af_heart"),
  orientation: z
    .nativeEnum(OrientationEnum)
    .optional()
    .describe("Orientation of the video, default is portrait"),
  musicVolume: z
    .nativeEnum(MusicVolumeEnum)
    .optional()
    .describe("Volume of the music, default is high"),
});
export type RenderConfig = z.infer<typeof renderConfig>;

export type Voices = `${VoiceEnum}`;

export type Video = {
  id: string;
  url: string;
  width: number;
  height: number;
};
export type Caption = {
  text: string;
  startMs: number;
  endMs: number;
};

export type CaptionLine = {
  texts: Caption[];
};
export type CaptionPage = {
  startMs: number;
  endMs: number;
  lines: CaptionLine[];
};

export const createShortInput = z.object({
  scenes: z.array(sceneInput).describe("Each scene to be created"),
  config: renderConfig.describe("Configuration for rendering the video"),
});
export type CreateShortInput = z.infer<typeof createShortInput>;

export type VideoStatus = "processing" | "ready" | "failed";

export type Music = {
  file: string;
  start: number;
  end: number;
  mood: string;
};
export type MusicForVideo = Music & {
  url: string;
};

export type MusicTag = `${MusicMoodEnum}`;

export type kokoroModelPrecision = "fp32" | "fp16" | "q8" | "q4" | "q4f16";

export type whisperModels =
  | "tiny"
  | "tiny.en"
  | "base"
  | "base.en"
  | "small"
  | "small.en"
  | "medium"
  | "medium.en"
  | "large-v1"
  | "large-v2"
  | "large-v3"
  | "large-v3-turbo";
