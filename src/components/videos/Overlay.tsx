import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { z } from "zod";
import type { shortVideoSchema } from "../utils";

type SceneOverlay = NonNullable<
  z.infer<typeof shortVideoSchema>["scenes"][number]["overlays"]
>[number];

const DEFAULT_SCALE = 0.55;
const DEFAULT_SOUND_VOLUME = 0.5;
const EXIT_SEC = 0.35; // fade-out length at the end of every overlay
const EDGE_MARGIN = "4%";

// White comic-style outline (4 hard shadows) + a soft drop shadow.
// drop-shadow follows the PNG's transparency, so it outlines the character, not the box.
const DEFAULT_OFFSET_Y = -0.15;

const OUTLINE_FILTER = [
  "drop-shadow(5px 0 0 white)",
  "drop-shadow(-5px 0 0 white)",
  "drop-shadow(0 5px 0 white)",
  "drop-shadow(0 -5px 0 white)",
  "drop-shadow(12px 16px 10px rgba(0,0,0,0.65))",
].join(" ");

// Where each position sits (flexbox alignment inside the full frame)
const LAYOUT: Record<
  SceneOverlay["position"],
  { justifyContent: string; alignItems: string; padding: string }
> = {
  left: { justifyContent: "flex-start", alignItems: "center", padding: `0 0 0 ${EDGE_MARGIN}` },
  right: { justifyContent: "flex-end", alignItems: "center", padding: `0 ${EDGE_MARGIN} 0 0` },
  center: { justifyContent: "center", alignItems: "center", padding: "0" },
  top: { justifyContent: "center", alignItems: "flex-start", padding: `${EDGE_MARGIN} 0 0 0` },
  bottom: { justifyContent: "center", alignItems: "flex-end", padding: `0 0 ${EDGE_MARGIN} 0` },
};

// Direction a "slide" comes in from (nearest edge). Center slides up from below.
const SLIDE_FROM: Record<SceneOverlay["position"], [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
  center: [0, 1],
};

const OverlayImage: React.FC<{ overlay: SceneOverlay; durationInFrames: number }> = ({
  overlay,
  durationInFrames,
}) => {
  // frame is relative to the start of this overlay's <Sequence>
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const exitFrames = Math.min(Math.round(EXIT_SEC * fps), Math.floor(durationInFrames / 2));
  const fadeOut = interpolate(
    frame,
    [durationInFrames - exitFrames, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  let opacity = fadeOut;
  let scale = 1;
  let translateX = 0;
  let translateY = 0;

  if (overlay.animation === "pop") {
    // low damping = bouncy overshoot past 1, then settles
    scale = spring({ frame, fps, config: { damping: 9, stiffness: 160, mass: 0.6 } });
    scale *= interpolate(fadeOut, [0, 1], [0.85, 1]); // shrink a little while fading out
  } else if (overlay.animation === "slide") {
    const progress = spring({ frame, fps, config: { damping: 200 }, durationInFrames: Math.round(0.5 * fps) });
    const [dx, dy] = SLIDE_FROM[overlay.position];
    translateX = dx * (1 - progress) * width;
    translateY = dy * (1 - progress) * height;
  } else {
    const fadeIn = interpolate(frame, [0, Math.round(0.35 * fps)], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    opacity = Math.min(fadeIn, fadeOut);
  }

  const layout = LAYOUT[overlay.position];
  // lift side/center images so faces sit above the (centered) captions
  const offsetY =
    overlay.offsetY ??
    (overlay.position === "top" || overlay.position === "bottom" ? 0 : DEFAULT_OFFSET_Y);
  translateY += offsetY * height;
  const imageWidth = (overlay.scale ?? DEFAULT_SCALE) * width;
  const transformOrigin =
    overlay.position === "left" ? "left center"
    : overlay.position === "right" ? "right center"
    : overlay.position === "top" ? "center top"
    : overlay.position === "bottom" ? "center bottom"
    : "center center";

  return (
    <AbsoluteFill style={{ display: "flex", flexDirection: "row", ...layout }}>
      <Img
        src={overlay.imageUrl}
        style={{
          width: imageWidth,
          maxHeight: offsetY < 0 ? `${Math.round(75 + offsetY * 100)}%` : "75%",
          objectFit: "contain",
          opacity,
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
          transformOrigin,
          filter: overlay.outline === false ? undefined : OUTLINE_FILTER,
        }}
      />
      {overlay.soundUrl ? (
        <Audio src={overlay.soundUrl} volume={overlay.soundVolume ?? DEFAULT_SOUND_VOLUME} />
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * Renders a scene's overlays. Place it inside the scene's <Sequence>,
 * after the background video and before the captions, so captions stay on top.
 */
export const SceneOverlays: React.FC<{
  overlays?: SceneOverlay[];
  sceneDurationSec: number;
  sceneKey: string;
}> = ({ overlays, sceneDurationSec, sceneKey }) => {
  const { fps } = useVideoConfig();
  if (!overlays || overlays.length === 0) {
    return null;
  }
  const sceneFrames = Math.round(sceneDurationSec * fps);

  return (
    <>
      {overlays.map((overlay, i) => {
        const from = Math.round(overlay.atSec * fps);
        // never run past the end of the scene (so the sound can't leak into the next one)
        const durationInFrames = Math.min(
          Math.round(overlay.durationSec * fps),
          sceneFrames - from,
        );
        if (durationInFrames <= 0) {
          return null;
        }
        return (
          <Sequence
            key={`${sceneKey}-overlay-${i}`}
            from={from}
            durationInFrames={durationInFrames}
            layout="none"
          >
            <OverlayImage overlay={overlay} durationInFrames={durationInFrames} />
          </Sequence>
        );
      })}
    </>
  );
};
