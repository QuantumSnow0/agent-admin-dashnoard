"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type Phase = "idle" | "loading" | "finishing";

function sameAppUrl(href: string): boolean {
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return false;
  }
  if (href.startsWith("http://") || href.startsWith("https://")) {
    try {
      return new URL(href).origin === window.location.origin;
    } catch {
      return false;
    }
  }
  return href.startsWith("/");
}

function pathAndSearch(href: string): string {
  try {
    const url = href.startsWith("http")
      ? new URL(href)
      : new URL(href, window.location.origin);
    return `${url.pathname}${url.search}`;
  } catch {
    return href;
  }
}

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>("idle");
  const [width, setWidth] = useState(0);
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const routeKeyRef = useRef(routeKey);
  const startTimerRef = useRef<number | null>(null);
  routeKeyRef.current = routeKey;

  const start = () => {
    if (startTimerRef.current != null) return;
    startTimerRef.current = window.setTimeout(() => {
      startTimerRef.current = null;
      setPhase("loading");
      setWidth(14);
    }, 0);
  };

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      const href = anchor.getAttribute("href");
      if (!href || !sameAppUrl(href)) return;
      if (pathAndSearch(href) === routeKeyRef.current) return;
      start();
    };

    window.addEventListener("click", onClick, true);
    window.addEventListener("popstate", start);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", start);
      if (startTimerRef.current != null) window.clearTimeout(startTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (phase === "idle") return;
    if (startTimerRef.current != null) {
      window.clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
    setPhase("finishing");
    setWidth(100);
    const hide = window.setTimeout(() => {
      setPhase("idle");
      setWidth(0);
    }, 320);
    return () => window.clearTimeout(hide);
    // Finish when the destination route is committed, not when loading starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  useEffect(() => {
    if (phase !== "loading") return;
    const tick = window.setInterval(() => {
      setWidth((current) => {
        if (current >= 86) return current;
        return current + Math.max(0.6, (86 - current) * 0.07);
      });
    }, 180);
    return () => window.clearInterval(tick);
  }, [phase]);

  const visible = phase !== "idle";

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-1"
    >
      <div
        className="h-full origin-left rounded-r-full bg-gradient-to-r from-indigo-500 via-sky-400 to-indigo-600 shadow-[0_0_16px_rgba(79,70,229,0.55)]"
        style={{
          width: `${width}%`,
          opacity: visible ? 1 : 0,
          transition:
            phase === "finishing"
              ? "width 220ms ease-out, opacity 280ms ease-out 80ms"
              : "width 280ms linear, opacity 150ms ease-out",
        }}
      />
    </div>
  );
}
