import { logger } from "../../logger";

// ElevenLabs text-to-speech: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
// We request raw 16-bit PCM and wrap it in a WAV header ourselves, so the rest of
// the pipeline gets exactly what Kokoro produces (WAV buffer + length in seconds).

const API = "https://api.elevenlabs.io/v1";
const SAMPLE_RATE = 24000; // pcm_24000 is available on all paid plans
const VOICES_CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 60000;

export const ELEVENLABS_PREFIX = "elevenlabs:";

export const ElevenLabsModels = [
  "eleven_multilingual_v2",
  "eleven_v3",
  "eleven_turbo_v2_5",
  "eleven_flash_v2_5",
] as const;
export type ElevenLabsModel = (typeof ElevenLabsModels)[number];

export type ElevenLabsSettings = {
  model?: ElevenLabsModel;
  speed?: number;
  stability?: number;
  similarity?: number;
  style?: number;
};

type ApiVoice = { voice_id: string; name: string; category?: string };

export class ElevenLabs {
  private voicesCache: { at: number; voices: ApiVoice[] } | null = null;

  constructor(private apiKey: string | undefined) {}

  public isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  public static isElevenLabsVoice(voice: string | undefined): boolean {
    return Boolean(voice && voice.startsWith(ELEVENLABS_PREFIX));
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.apiKey) {
      throw new Error(
        "ELEVENLABS_API_KEY is not set - add it with the start script (E:\\doomsday-art\\start-video-maker.ps1)",
      );
    }
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        "xi-api-key": this.apiKey,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 400);
      if (res.status === 401) {
        throw new Error(`ElevenLabs rejected the API key (401): ${body}`);
      }
      throw new Error(`ElevenLabs error ${res.status}: ${body}`);
    }
    return res;
  }

  /** Voices in your ElevenLabs "My Voices" (your clones + library voices you added). */
  public async listVoices(): Promise<ApiVoice[]> {
    if (this.voicesCache && Date.now() - this.voicesCache.at < VOICES_CACHE_MS) {
      return this.voicesCache.voices;
    }
    const res = await this.request("/voices");
    const data = (await res.json()) as { voices?: ApiVoice[] };
    const voices = (data.voices ?? []).map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
    }));
    this.voicesCache = { at: Date.now(), voices };
    return voices;
  }

  /**
   * "elevenlabs:Hope" -> voice_id. Accepts an exact name, the start of a name
   * ("Hope" matches "Hope - upbeat and clear"), or a raw voice_id.
   */
  public async resolveVoiceId(voice: string): Promise<{ id: string; name: string }> {
    const wanted = voice.slice(ELEVENLABS_PREFIX.length).trim();
    const voices = await this.listVoices();
    const lower = wanted.toLowerCase();
    const match =
      voices.find((v) => v.voice_id === wanted) ??
      voices.find((v) => v.name.toLowerCase() === lower) ??
      voices.find((v) => v.name.toLowerCase().startsWith(lower)) ??
      voices.find((v) => v.name.toLowerCase().includes(lower));
    if (!match) {
      const names = voices.map((v) => v.name).join(", ") || "(none)";
      throw new Error(
        `ElevenLabs voice "${wanted}" not found in your My Voices. Available: ${names}. ` +
          `Library voices must be added to My Voices on elevenlabs.io first.`,
      );
    }
    return { id: match.voice_id, name: match.name };
  }

  async generate(
    text: string,
    voice: string,
    settings: ElevenLabsSettings = {},
    context: { previousText?: string; nextText?: string } = {},
  ): Promise<{ audio: ArrayBuffer; audioLength: number }> {
    const { id, name } = await this.resolveVoiceId(voice);
    const model: ElevenLabsModel = settings.model ?? "eleven_multilingual_v2";

    const voiceSettings: Record<string, number | boolean> = {};
    if (settings.stability !== undefined) {
      // v3 only accepts 0 (Creative), 0.5 (Natural) or 1 (Robust)
      voiceSettings.stability =
        model === "eleven_v3"
          ? [0, 0.5, 1].reduce((a, b) =>
              Math.abs(b - settings.stability!) < Math.abs(a - settings.stability!) ? b : a,
            )
          : settings.stability;
    }
    if (settings.similarity !== undefined) voiceSettings.similarity_boost = settings.similarity;
    if (settings.style !== undefined) voiceSettings.style = settings.style;
    if (settings.speed !== undefined) voiceSettings.speed = settings.speed;

    const body: Record<string, unknown> = { text, model_id: model };
    if (Object.keys(voiceSettings).length > 0) body.voice_settings = voiceSettings;
    // neighbouring scene text keeps the intonation natural across scene cuts (not v3)
    if (model !== "eleven_v3") {
      if (context.previousText) body.previous_text = context.previousText;
      if (context.nextText) body.next_text = context.nextText;
    }

    const res = await this.request(
      `/text-to-speech/${encodeURIComponent(id)}?output_format=pcm_${SAMPLE_RATE}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "audio/pcm" },
        body: JSON.stringify(body),
      },
    );
    const pcm = Buffer.from(await res.arrayBuffer());
    if (pcm.length === 0) {
      throw new Error("ElevenLabs returned empty audio");
    }

    const audioLength = pcm.length / 2 / SAMPLE_RATE; // 16-bit mono
    logger.info(
      { voice: name, model, characters: text.length, audioLength, settings },
      "Audio generated with ElevenLabs (characters count toward your plan)",
    );
    return { audio: ElevenLabs.pcmToWav(pcm, SAMPLE_RATE), audioLength };
  }

  static pcmToWav(pcm: Buffer, sampleRate: number): ArrayBuffer {
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16); // fmt chunk size
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28); // byte rate
    header.writeUInt16LE(2, 32); // block align
    header.writeUInt16LE(16, 34); // bits per sample
    header.write("data", 36);
    header.writeUInt32LE(pcm.length, 40);
    const wav = Buffer.concat([header, pcm]);
    return wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
  }
}
