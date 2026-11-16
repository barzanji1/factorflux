import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { usePendingNavigation } from "@/lib/seamless-navigation";
import { PageSkeleton } from "./PageSkeleton";
import "./loading.css";

type MainRect = { top: number; left: number; width: number; height: number; backgroundColor: string; color: string };

function isInternalPath(pathname: string) {
  return pathname.startsWith("/") && pathname !== "/login" && pathname !== "/portal" && !pathname.startsWith("/portal/");
}

function titleForTarget(target: string) {
  const pathname = target.split(/[?#]/u)[0] || "/";
  const segment = pathname.split("/").filter(Boolean).at(-1);
  if (!segment) return "Agent Dashboard";
  return segment.split("-").map(word => word ? word[0].toUpperCase() + word.slice(1) : "").join(" ");
}

export function NavigationPending() {
  const target = usePendingNavigation();
  const [currentPath] = useLocation();
  const { user, isLoading } = useAuth();
  const [rect, setRect] = useState<MainRect | null>(null);
  const pathname = currentPath.split(/[?#]/u)[0] || "/";
  const targetPath = target?.split(/[?#]/u)[0] || "";
  const visible = Boolean(target && user && !isLoading && isInternalPath(pathname) && isInternalPath(targetPath));
  const title = target ? titleForTarget(target) : "";

  useLayoutEffect(() => {
    if (!visible) {
      setRect(null);
      return;
    }
    const main = document.querySelector<HTMLElement>("main");
    if (!main) {
      setRect(null);
      return;
    }

    const wasInert = main.inert;
    main.inert = true;
    const update = () => {
      const bounds = main.getBoundingClientRect();
      let surface: HTMLElement | null = main;
      let backgroundColor = "";
      while (surface && !backgroundColor) {
        const candidate = window.getComputedStyle(surface).backgroundColor;
        if (candidate && candidate !== "rgba(0, 0, 0, 0)" && candidate !== "transparent") backgroundColor = candidate;
        else surface = surface.parentElement;
      }
      setRect({
        top: bounds.top,
        left: bounds.left,
        width: bounds.width,
        height: bounds.height,
        backgroundColor: backgroundColor || "#e0e0e0",
        color: window.getComputedStyle(main).color,
      });
    };
    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(main);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      main.inert = wasInert;
    };
  }, [visible, target]);

  if (!visible || !rect || rect.width <= 0 || rect.height <= 0) return null;
  return createPortal(
    <div
      className="ff-loading-navigation-pending"
      data-navigation-pending
      role="status"
      aria-live="polite"
      aria-label={`Loading ${title}`}
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height, backgroundColor: rect.backgroundColor, color: rect.color }}
    >
      <div className="ff-loading-navigation-pending__content">
        <p className="ff-loading-navigation-pending__label">{title}</p>
        <PageSkeleton status={false} />
      </div>
    </div>,
    document.querySelector(".ff-institutional-root") ?? document.body,
  );
}

export default NavigationPending;
