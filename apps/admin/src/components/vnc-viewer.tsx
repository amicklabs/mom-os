"use client";

import type RFB from "@novnc/novnc";
import { useEffect, useRef, useState } from "react";
import { pingUrl } from "@/lib/screen-share";

export type ViewerStatus =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "reconnecting" }
  | { kind: "unreachable" } // this device can't reach the laptop at all
  | { kind: "failed"; reason: string };

// Her screen through noVNC. It connects over wss:// to the laptop's Tailscale
// name, sending the session token as a WebSocket subprotocol, and reconnects
// by itself when the laptop drops the connection, as it does when control is
// turned on or off. `control` only sets what the browser sends; the laptop
// runs wayvnc with input off unless the session allows control.
export function VncViewer({
  url,
  token,
  control,
  onStatus,
  onReady,
  className = "",
}: {
  url: string;
  token: string;
  control: boolean;
  onStatus?: (s: ViewerStatus) => void;
  onReady?: (rfb: RFB | null) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const controlRef = useRef(control);
  const statusRef = useRef(onStatus);
  const readyRef = useRef(onReady);
  const [status, setStatus] = useState<ViewerStatus>({ kind: "connecting" });

  useEffect(() => {
    statusRef.current = onStatus;
    readyRef.current = onReady;
  }, [onStatus, onReady]);

  useEffect(() => {
    controlRef.current = control;
    const rfb = rfbRef.current;
    if (rfb) {
      rfb.viewOnly = !control;
      rfb.focusOnClick = control;
    }
  }, [control]);

  useEffect(() => {
    let stopped = false;
    let everConnected = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const report = (s: ViewerStatus) => {
      if (stopped) return;
      setStatus(s);
      statusRef.current?.(s);
    };

    // After a failure before any connection: can this device reach the
    // laptop's HTTPS port at all? If not, Tailscale is probably off here.
    const diagnose = async () => {
      const ping = pingUrl(url);
      if (!ping) return false;
      try {
        const res = await fetch(ping, { cache: "no-store", signal: AbortSignal.timeout(5000) });
        return res.ok;
      } catch {
        return false;
      }
    };

    const connect = async () => {
      const { default: RFBClass } = await import("@novnc/novnc");
      if (stopped || !box.current) return;
      const rfb = new RFBClass(box.current, url, { shared: true, wsProtocols: ["binary", `momos.${token}`] });
      rfb.viewOnly = !controlRef.current;
      rfb.focusOnClick = controlRef.current;
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.background = "#0c0a09";
      rfb.qualityLevel = 6;
      rfb.compressionLevel = 2;
      rfbRef.current = rfb;
      rfb.addEventListener("connect", () => {
        everConnected = true;
        failures = 0;
        report({ kind: "connected" });
        readyRef.current?.(rfb);
      });
      rfb.addEventListener("securityfailure", (e) => {
        const detail = (e as CustomEvent<{ reason?: string }>).detail;
        report({ kind: "failed", reason: detail?.reason || "the laptop refused the connection" });
      });
      rfb.addEventListener("disconnect", () => {
        rfbRef.current = null;
        readyRef.current?.(null);
        if (stopped) return;
        failures++;
        const again = () => {
          const delay = Math.min(10_000, 1000 * 2 ** Math.min(failures - 1, 4));
          timer = setTimeout(() => void connect(), delay);
        };
        if (!everConnected && failures >= 2) {
          void diagnose().then((ok) => {
            report(ok ? { kind: "reconnecting" } : { kind: "unreachable" });
            again();
          });
        } else {
          report(everConnected ? { kind: "reconnecting" } : { kind: "connecting" });
          again();
        }
      });
    };

    void connect().catch((e: unknown) => report({ kind: "failed", reason: e instanceof Error ? e.message : String(e) }));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      const rfb = rfbRef.current;
      rfbRef.current = null;
      readyRef.current?.(null);
      rfb?.disconnect();
    };
  }, [url, token]);

  return (
    <div className={`relative overflow-hidden bg-stone-950 ${className}`}>
      <div ref={box} className="absolute inset-0" />
      {status.kind !== "connected" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-stone-300">
          {status.kind === "connecting" && "Connecting to the screen..."}
          {status.kind === "reconnecting" && "Reconnecting..."}
          {status.kind === "unreachable" && "This device can't reach the laptop. Turn on Tailscale here, then wait a moment."}
          {status.kind === "failed" && `Couldn't connect: ${status.reason}`}
        </div>
      )}
    </div>
  );
}
