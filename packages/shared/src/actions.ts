import { z } from "zod";
import { Id } from "./config";
import { SCREEN_SHARE_MAX_MINUTES } from "./screenshare";

// The only things a remote party may ask momd to do through Convex. Each one is
// harmless: the worst misuse is a message on her screen, a locked screen, a
// reboot, or pictures of her screen.
// Anything more powerful goes over SSH from the helper's machines.

export const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("say"), text: z.string().min(1).max(280), seconds: z.number().int().min(5).max(3600).nullish() }),
  z.object({ type: z.literal("home") }),
  z.object({ type: z.literal("open"), tileId: Id }),
  z.object({ type: z.literal("lock") }),
  // Takes a picture and uploads it. Nothing shows on her screen: she asked
  // for screenshots to be silent.
  z.object({ type: z.literal("screenshot") }),
  // Shows "Sam is restarting the computer" for about 10 seconds, then reboots.
  // momd refuses one that waited more than 10 minutes, so a laptop that was
  // off when it was sent doesn't reboot by surprise later.
  z.object({ type: z.literal("restart") }),
  // Shows "Sam is looking at your last few minutes", then uploads the ring
  // buffer's pictures, one a minute for the last ten minutes. They never
  // leave the laptop otherwise.
  z.object({ type: z.literal("recent-screens") }),
  // Shows "Sam saw your message" after he taps Got it on her help request.
  z.object({ type: z.literal("help-seen") }),
  // Reloads one of her tiles' pages: brings its window forward and presses F5,
  // or opens it if it isn't open. Only web app tiles and the Browser tile
  // (isReloadable in config.ts). Convex refuses a tile that isn't in her
  // settings, and momd refuses one that waited more than 10 minutes.
  z.object({ type: z.literal("reload"), tileId: Id }),
  // Starts or stops screen sharing to the admin app in a browser. "start"
  // opens a listener on 127.0.0.1, which Tailscale Serve passes the helper's
  // devices through to, for `minutes`, then closes it by itself. `control`
  // lets the viewer use her mouse and keyboard; without it wayvnc runs with
  // input off. A "start" while a session runs changes `control` and the time
  // left. momd refuses a "start" that waited more than 2 minutes. Only the
  // admin app may queue it (docs/contracts.md, "Screen sharing in a browser").
  z.object({
    type: z.literal("screen-share"),
    op: z.enum(["start", "stop"]),
    control: z.boolean().optional(),
    minutes: z.number().int().min(1).max(SCREEN_SHARE_MAX_MINUTES).optional(),
  }),
]);
export type Action = z.infer<typeof Action>;
export type ActionType = Action["type"];
