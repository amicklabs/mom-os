import { z } from "zod";

// Screen sharing to the admin app in a browser. See docs/contracts.md,
// "Screen sharing in a browser".

// The listener momd opens on 127.0.0.1 while a session runs. Tailscale Serve
// on the laptop passes https://<laptop>.ts.net/ (port 443) through to it.
export const SCREEN_SHARE_PORT = 5901;
export const SCREEN_SHARE_DEFAULT_MINUTES = 15;
export const SCREEN_SHARE_MAX_MINUTES = 60;
// A "start" that waited longer than this in Convex is refused.
export const SCREEN_SHARE_MAX_AGE_MS = 2 * 60_000;
// The browser sends the session token as a WebSocket subprotocol,
// `momos.<token>`, next to "binary". Never in the URL.
export const SCREEN_SHARE_PROTOCOL_PREFIX = "momos.";

// What momd reports to Convex with device.reportScreenShare while a session
// runs, and null once it has ended. `url` is the wss:// address the browser
// connects to. `token` is random for each session and useless after it.
export const ScreenShareSession = z.object({
  url: z.string().regex(/^wss:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9/_-]*$/),
  token: z.string().regex(/^[0-9a-f]{64}$/),
  control: z.boolean(),
  startedAt: z.number(),
  expiresAt: z.number(),
  // False when `tailscale serve` isn't passing port 443 to momd, so the
  // browser can't reach it. The admin app says so.
  served: z.boolean(),
});
export type ScreenShareSession = z.infer<typeof ScreenShareSession>;
