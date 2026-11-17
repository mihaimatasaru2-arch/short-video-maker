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
| `sound` | none | file in the sounds folder (.mp3/.wav/.ogg/.m4a), plays when the image appears |
| `soundVolume` | 0.5 | 0 to 1 |

Folders (inside Docker): `/app/data/overlays` and `/app/data/sounds`.
Override with `OVERLAYS_DIR_PATH` / `SOUNDS_DIR_PATH`. Missing files are rejected
when the request is made. Overlays are drawn above the background video and
below the captions.
