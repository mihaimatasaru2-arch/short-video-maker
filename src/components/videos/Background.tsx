import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Video,
  interpolate,
  useCurrentFrame,
} from "remotion";

const COVER: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

/** A still photo with a slow "Ken Burns" zoom so it doesn't look frozen. */
const ZoomingImage: React.FC<{ src: string; durationInFrames: number }> = ({
  src,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, Math.max(1, durationInFrames)], [1, 1.15], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "black" }}>
      <Img src={src} style={{ ...COVER, transform: `scale(${scale})` }} />
    </AbsoluteFill>
  );
};

/**
 * Scene background.
 * - no `background` info (Pexels): exactly the original <OffthreadVideo>.
 * - local video: loops if shorter than the scene, cropped to fill the frame.
 * - local image: slow zoom.
 */
export const SceneBackground: React.FC<{
  src: string;
  background?: { kind: "video" | "image" };
  durationInFrames: number;
}> = ({ src, background, durationInFrames }) => {
  if (!background) {
    return <OffthreadVideo src={src} muted />;
  }
  if (background.kind === "image") {
    return <ZoomingImage src={src} durationInFrames={durationInFrames} />;
  }
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Video src={src} muted loop style={COVER} />
    </AbsoluteFill>
  );
};
