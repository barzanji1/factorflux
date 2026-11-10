export interface LoginSuccessTransition {
  readonly hasNavigated: boolean;
  cancel(): void;
}

const RING_DELAYS = [0, 110, 220, 330];
const REVEAL_DELAY = 700;
const REVEAL_CLEANUP_DELAY = 550;
const HARD_CLEANUP_DELAY = 1350;

interface CardMetrics {
  padding: string;
  borderRadius: string;
}

function cloneWithoutCredentials(node: Node, decorativeIds: Map<string, string>): Node {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent ?? "");
  }

  if (!(node instanceof Element)) return document.createTextNode("");
  if (node.classList.contains("ff-login-hover-ripple")) return document.createTextNode("");

  const clone = node.cloneNode(false) as Element;
  const deniedAttributes = new Set([
    "id", "name", "form", "value", "checked", "selected", "autocomplete",
    "autofocus", "tabindex", "contenteditable", "href", "action", "method",
    "target", "for",
  ]);

  for (const attribute of Array.from(clone.attributes)) {
    if (deniedAttributes.has(attribute.name.toLowerCase()) || /^on/i.test(attribute.name)) {
      clone.removeAttribute(attribute.name);
    }
  }
  // Retain only remapped SVG definition IDs. Never carry form IDs/values into
  // the overlay; unique filter IDs keep the material intact after route unmount.
  if (node instanceof SVGElement && node.id && decorativeIds.has(node.id)) {
    clone.id = decorativeIds.get(node.id)!;
  }
  for (const attribute of Array.from(clone.attributes)) {
    const replaced = attribute.value.replace(/url\(["']?#([^"')]+)["']?\)/g, (match, id: string) =>
      decorativeIds.has(id) ? `url(#${decorativeIds.get(id)})` : match);
    if (replaced !== attribute.value) clone.setAttribute(attribute.name, replaced);
  }

  const tagName = node.tagName.toLowerCase();
  if (tagName === "input") {
    const input = clone as HTMLInputElement;
    input.removeAttribute("value");
    input.removeAttribute("checked");
    input.value = "";
    input.defaultValue = "";
    input.checked = false;
    input.defaultChecked = false;
    input.disabled = true;
  } else if (tagName === "textarea") {
    const textarea = clone as HTMLTextAreaElement;
    textarea.value = "";
    textarea.defaultValue = "";
    textarea.disabled = true;
  } else if (tagName === "select") {
    const select = clone as HTMLSelectElement;
    select.selectedIndex = -1;
    select.disabled = true;
  } else if (tagName === "button") {
    (clone as HTMLButtonElement).disabled = true;
  } else if (tagName === "option") {
    clone.removeAttribute("selected");
  }

  if (tagName === "textarea") return clone;

  for (const child of Array.from(node.childNodes)) {
    clone.appendChild(cloneWithoutCredentials(child, decorativeIds));
  }

  return clone;
}

function applyCardGeometry(
  clone: HTMLElement,
  left: number,
  top: number,
  width: number,
  height: number,
  computed: CardMetrics,
): void {
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("role", "presentation");
  clone.inert = true;
  clone.classList.remove("ff-login-card--shake-0", "ff-login-card--shake-1");
  clone.style.setProperty("position", "absolute", "important");
  clone.style.setProperty("left", `${left}px`, "important");
  clone.style.setProperty("top", `${top}px`, "important");
  clone.style.setProperty("width", `${width}px`, "important");
  clone.style.setProperty("height", `${height}px`, "important");
  clone.style.setProperty("min-height", "0", "important");
  clone.style.setProperty("max-width", "none", "important");
  clone.style.setProperty("margin", "0", "important");
  clone.style.setProperty("padding", computed.padding, "important");
  clone.style.setProperty("border-radius", computed.borderRadius, "important");
  clone.style.setProperty("box-sizing", "border-box", "important");
  clone.style.setProperty("pointer-events", "none", "important");
}

function copyMainBackground(main: HTMLElement, width: number, height: number): HTMLDivElement {
  const computed = window.getComputedStyle(main);
  const background = document.createElement("div");
  background.className = "ff-login-transition-background";
  background.setAttribute("aria-hidden", "true");
  background.style.width = `${width}px`;
  background.style.height = `${height}px`;
  background.style.backgroundColor = computed.backgroundColor;
  background.style.backgroundImage = computed.backgroundImage;
  background.style.backgroundPosition = computed.backgroundPosition;
  background.style.backgroundSize = computed.backgroundSize;
  background.style.backgroundRepeat = computed.backgroundRepeat;
  background.style.backgroundOrigin = computed.backgroundOrigin;
  background.style.backgroundClip = computed.backgroundClip;
  background.style.backgroundAttachment = computed.backgroundAttachment;
  return background;
}

export function playLoginSuccess(
  card: HTMLElement | null,
  onReveal: () => void,
  origin?: HTMLElement | null,
): LoginSuccessTransition {
  let active = true;
  let navigated = false;
  let overlay: HTMLDivElement | null = null;
  const timers = new Set<number>();

  const clearTimers = () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
  };

  const cleanup = () => {
    if (!active) return;
    active = false;
    clearTimers();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    overlay?.remove();
    overlay = null;
  };

  const later = (callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (active) callback();
    }, delay);
    timers.add(timer);
  };

  const navigateOnce = () => {
    if (!active || navigated) return;
    navigated = true;
    try {
      onReveal();
    } catch {
      cleanup();
    }
  };

  // Navigate while the overlay still covers the screen, then fade it out so the
  // dashboard appears underneath without a hard cut.
  const reveal = () => {
    if (!active || navigated) return;
    overlay?.classList.add("is-revealing");
    navigateOnce();
    later(cleanup, REVEAL_CLEANUP_DELAY);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState !== "hidden") return;
    if (!navigated) reveal();
    else cleanup();
  };

  const handle: LoginSuccessTransition = {
    get hasNavigated() {
      return navigated;
    },
    cancel: cleanup,
  };

  const skipAnimation = () => {
    later(() => {
      navigateOnce();
      cleanup();
    }, 0);
  };

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (reducedMotion || !card || !document.body) {
    skipAnimation();
    return handle;
  }

  try {
    const main = card.closest<HTMLElement>(".ff-login-page");
    if (!main) throw new Error("Login surface not found");
    const cardRect = card.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const originalCardStyle = window.getComputedStyle(card);
    const cardMetrics = {
      padding: originalCardStyle.padding,
      borderRadius: originalCardStyle.borderRadius,
    };
    const decorativeIds = new Map(
      Array.from(card.querySelectorAll<SVGElement>("svg [id]")).map((element, index) =>
        [element.id, `login-reveal-${index}-${element.id}`] as const),
    );
    const safeCard = cloneWithoutCredentials(card, decorativeIds) as HTMLElement;
    safeCard.classList.add("ff-login-transition-card");
    applyCardGeometry(safeCard, cardRect.left, cardRect.top, cardRect.width, cardRect.height, cardMetrics);

    const originRect = (origin ?? card).getBoundingClientRect();
    const centerX = originRect.left + originRect.width / 2;
    const centerY = originRect.top + originRect.height / 2;
    const maxRadius = Math.max(
      Math.hypot(centerX, centerY),
      Math.hypot(window.innerWidth - centerX, centerY),
      Math.hypot(centerX, window.innerHeight - centerY),
      Math.hypot(window.innerWidth - centerX, window.innerHeight - centerY),
    );

    overlay = document.createElement("div");
    overlay.className = "ff-login-page ff-login-transition";
    overlay.setAttribute("aria-hidden", "true");
    overlay.inert = true;
    const background = copyMainBackground(main, mainRect.width, mainRect.height);
    background.style.left = `${mainRect.left}px`;
    background.style.top = `${mainRect.top}px`;
    overlay.appendChild(background);
    overlay.appendChild(safeCard);

    RING_DELAYS.forEach((delay) => {
      const ring = document.createElement("div");
      ring.className = "ff-login-transition-ring";
      ring.style.left = `${centerX}px`;
      ring.style.top = `${centerY}px`;
      ring.style.setProperty("--ring-size", `${Math.ceil(maxRadius * 2)}px`);
      ring.style.setProperty("--ring-delay", `${delay}ms`);
      overlay!.appendChild(ring);
    });

    document.body.appendChild(overlay);
    document.addEventListener("visibilitychange", onVisibilityChange);
    later(reveal, REVEAL_DELAY);
    later(() => {
      if (!navigated) reveal();
      else cleanup();
    }, HARD_CLEANUP_DELAY);
    if (document.visibilityState === "hidden") reveal();
  } catch {
    clearTimers();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    overlay?.remove();
    overlay = null;
    skipAnimation();
  }

  return handle;
}
