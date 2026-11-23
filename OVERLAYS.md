# Comic character pop-ups (overlays)

Each scene can have an optional `overlays` array. Images come from the overlays
folder, sounds from the sounds folder (plain file names only, no paths).

```json
{
  "text": "A failed experiment scarred his face. He blamed one man: Reed Richards.",
  "searchTerms": ["nebula", "galaxy"],
  "overlays": [
    { "image": "doom.png", "atSec": 0.3, "durationSec": 2.5,
      "position": "left", "animation": "pop", "sound": "whoosh.mp3", "soundVolume": 0.5 }
  ]
}
```

| field | default | notes |
|---|---|---|
| `image` | required | file in the overlays folder (.png/.webp/.jpg/.gif) |
| `atSec` | 0 | seconds from the start of the scene |
| `durationSec` | 2.5 | cut off automatically at the end of the scene |
| `position` | center | left, right, center, top, bottom |
| `animation` | pop | pop (springy overshoot), slide (from nearest edge), fade |
| `scale` | 0.55 | image width as a fraction of frame width |
| `outline` | true | white comic outline + drop shadow |
| `offsetY` | -0.15 (left/right/center), 0 (top/bottom) | vertical shift as a fraction of frame height; negative = higher, keeps faces above centered captions |
| `sound` | none | file in the sounds folder (.mp3/.wav/.ogg/.m4a), plays when the image appears |
| `soundVolume` | 0.5 | 0 to 1 |

Folders (inside Docker): `/app/data/overlays` and `/app/data/sounds`.
Override with `OVERLAYS_DIR_PATH` / `SOUNDS_DIR_PATH`. Missing files are rejected
when the request is made. Overlays are drawn above the background video and
below the captions.

## Your own backgrounds (no Pexels key needed)

Put `.mp4`/`.webm`/`.mov` clips or `.jpg`/`.png`/`.webp` photos in the backgrounds
folder (inside Docker: `/app/data/backgrounds`, override with `BACKGROUNDS_DIR_PATH`).
When that folder has files, it is used instead of Pexels and `PEXELS_API_KEY` is optional.

- Each scene's `searchTerms` are matched against the words in the file names, so
  name files like `nebula-green-space.jpg` or `galaxy-purple-stars.mp4`.
- The best match is picked, avoiding clips already used in the same video.
- Short clips loop; photos get a slow zoom. Everything is cropped to fill the frame.

## Pixabay backgrounds

Set `PIXABAY_API_KEY` (free key at https://pixabay.com/api/docs/ when logged in).
Background priority per scene:

1. a file in your backgrounds folder whose name matches a search term
2. Pixabay video search (vertical clips preferred; landscape clips are cropped to fill, using 4K when needed so it stays sharp)
3. Pexels, if `PEXELS_API_KEY` is set
4. any file from your backgrounds folder

Pixabay searches are cached for 24 hours as their API terms require. The chosen
clip's Pixabay page and author are written to the log ("Picked Pixabay video").

## ElevenLabs voices

Set `ELEVENLABS_API_KEY`, then use `"voice": "elevenlabs:<name>"` in `config`
(the start of the name is enough, e.g. `elevenlabs:Hope`). The voice must be in
your ElevenLabs **My Voices** (your clones, plus library voices you added).
`GET /api/voices/all` and the MCP tool `list-voices` show the exact names.

Optional `config.voiceSettings` (ElevenLabs only):

| field | range | notes |
|---|---|---|
| `model` | `eleven_multilingual_v2` (default), `eleven_v3`, `eleven_turbo_v2_5`, `eleven_flash_v2_5` | v2 supports `<break time="1.0s" />` in the text; v3 understands `[whispers]`, `[excited]` etc. |
| `speed` | 0.7–1.2 | ~0.9 dramatic, ~1.05 fast facts |
| `stability` | 0–1 | lower = more emotional (v3 rounds to 0 / 0.5 / 1) |
| `similarity` | 0–1 | keep ~0.8+ for a cloned voice |
| `style` | 0–1 | 0.2–0.4 adds flair |

Kokoro voices still work and stay the default. Each ElevenLabs call logs how many
characters it used, since those count toward your plan.

## Captions

Captions show your exact script words (names, numbers, punctuation), timed by
what Whisper hears in the audio. ElevenLabs `[tags]` and `<break />` tags are
never shown. If the audio doesn't match the script, Whisper's words are used.

## Consistent backgrounds

Set `"backgroundSource": "local"` in `config` to use only your backgrounds folder.
Each scene gets the file whose name best matches its `searchTerms` (unused files
first), so name files by style, e.g. `nebula-purple-dark-01.mp4`, `comic-vs-red.mp4`.

## Caption styles

Set `config.captionStyle`:

| Style | Look |
|---|---|
| `classic` (default) | Big Barlow words on a colored box |
| `cinematic` | Cinzel capitals, cream text, spoken word glows gold, 2-4 words per chunk |
| `cinematic-purple` | Same, spoken word glows purple |
| `cinematic-dim` | Same chunks, words still to come are dimmed |
| `subtitle` | Small Inter text, up to 8 words on 2 lines, upcoming words dimmed, spoken word outlined in purple |

Chunks end at punctuation, at pauses over 350 ms, or at the word/letter limit.
