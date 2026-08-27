import { Composition } from "remotion";
import { Reel } from "./Reel";
import { reelDuration, type Project } from "./types";
import projectJson from "./project.json";

const defaultProject = projectJson as unknown as Project;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Reel"
      component={Reel}
      // `transparent` isn't a real Project field — it's a transient flag the
      // server stashes onto this scratch project.json only for an alpha
      // export, read back here the same way `project` itself is.
      defaultProps={{ project: defaultProject, debugZones: false, transparent: (projectJson as any).transparent ?? false }}
      // Duration and dimensions come from the project passed in props.
      calculateMetadata={({ props }) => {
        const p = props.project as Project;
        return {
          durationInFrames: reelDuration(p),
          fps: p.fps,
          width: p.width,
          height: p.height,
        };
      }}
    />
  );
};
