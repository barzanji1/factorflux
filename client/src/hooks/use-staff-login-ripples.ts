import { useEffect, type RefObject } from "react";

type Flag = { readonly current: boolean };
const CONTROLS = "input, textarea, select, button, a, label, [role='button'], [role='textbox'], [contenteditable], [data-liquid-glass-no-ripple]";
const MAX_RIPPLES = 4;
const MOVE_DISTANCE = 24;
const MOVE_INTERVAL = 150;

/** Login-only pointer effects; never cancel or capture a form interaction. */
export function attachStaffLoginRipples(
  face: HTMLDivElement,
  transitioning: Flag,
  busy: Flag,
) {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = preference.matches;
  let last: { x: number; y: number; at: number } | undefined;
  const active = new Map<HTMLSpanElement, ReturnType<typeof setTimeout>>();
  const remove = (ripple: HTMLSpanElement) => {
    const timer = active.get(ripple);
    if (timer !== undefined) clearTimeout(timer);
    active.delete(ripple);
    ripple.remove();
  };
  const clear = () => {
    for (const ripple of active.keys()) remove(ripple);
    last = undefined;
  };
  const emit = (event: PointerEvent, press: boolean) => {
    if (reduced || busy.current || transitioning.current || event.defaultPrevented) return;
    if (!press && event.pointerType === "touch") return;
    if (press && event.button !== undefined && event.button !== 0) return;
    if ((event.target as Element | null)?.closest?.(CONTROLS)) return;
    // Native pointerenter targets the card even when entering over a control.
    if (event.type === "pointerenter" &&
      document.elementFromPoint?.(event.clientX, event.clientY)?.closest(CONTROLS)) return;
    const bounds = face.getBoundingClientRect();
    const x = event.clientX - bounds.left - face.clientLeft;
    const y = event.clientY - bounds.top - face.clientTop;
    if (!press && event.type === "pointermove" && last &&
      (Math.hypot(x - last.x, y - last.y) < MOVE_DISTANCE || event.timeStamp - last.at < MOVE_INTERVAL)) return;
    last = { x, y, at: event.timeStamp };

    while (active.size >= MAX_RIPPLES) remove(active.keys().next().value!);
    const ripple = document.createElement("span");
    ripple.className = `staff-login-ripple${press ? " staff-login-ripple--press" : ""}`;
    ripple.setAttribute("aria-hidden", "true");
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    const lifetime = press ? 1000 : 800;
    ripple.style.setProperty("--staff-ripple-lifetime", `${lifetime}ms`);
    for (let index = 0; index < 3; index++) {
      const ring = document.createElement("span");
      ring.className = "staff-login-ripple__ring";
      ring.style.setProperty("--staff-ring-delay", `${index * 85}ms`);
      ripple.appendChild(ring);
    }
    ripple.addEventListener("animationend", event => {
      if (event.target === ripple && event.animationName === "staff-login-ripple-lifetime") remove(ripple);
    });
    face.appendChild(ripple);
    // Also expire when animations are paused, unsupported, or the tab is hidden.
    active.set(ripple, setTimeout(() => remove(ripple), lifetime + 100));
  };
  const enter = (event: PointerEvent) => { last = undefined; emit(event, false); };
  const move = (event: PointerEvent) => emit(event, false);
  const press = (event: PointerEvent) => emit(event, true);
  const leave = () => { last = undefined; };
  const change = (event: MediaQueryListEvent) => {
    reduced = event.matches;
    if (reduced) clear();
  };
  face.addEventListener("pointerenter", enter);
  face.addEventListener("pointermove", move);
  face.addEventListener("pointerdown", press);
  face.addEventListener("pointerleave", leave);
  preference.addEventListener("change", change);
  return () => {
    face.removeEventListener("pointerenter", enter);
    face.removeEventListener("pointermove", move);
    face.removeEventListener("pointerdown", press);
    face.removeEventListener("pointerleave", leave);
    preference.removeEventListener("change", change);
    clear();
  };
}

export function useStaffLoginRipples(
  face: RefObject<HTMLDivElement>,
  disabled: boolean,
  transitioning: Flag,
  busy: Flag,
) {
  useEffect(() => {
    if (disabled || !face.current) return;
    return attachStaffLoginRipples(face.current, transitioning, busy);
  }, [face, disabled, transitioning, busy]);
}
