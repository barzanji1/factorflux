export interface LoginSuccessTransition {
  readonly hasNavigated: boolean;
  cancel(): void;
}

const PULSE_DURATION = 200;
const REVEAL_CLEANUP_DELAY = 825;
const HARD_CLEANUP_DELAY = 1350;

interface CardMetrics {
  padding: string;
  borderRadius: string;
}

function cloneWithoutCredentials(node: Node): Node {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent ?? "");
  }

  if (!(node instanceof Element)) return document.createTextNode("");

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
    clone.appendChild(cloneWithoutCredentials(child));
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

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function createShards(
  root: HTMLElement,
  safeCard: HTMLElement,
  cardRect: DOMRect,
  cardComputed: CardMetrics,
): void {
  const cells = 4;
  const vertices: Array<Array<{ x: number; y: number }>> = [];

  for (let row = 0; row <= cells; row += 1) {
    const line: Array<{ x: number; y: number }> = [];
    for (let column = 0; column <= cells; column += 1) {
      const x = (column / cells) * 100;
      const y = (row / cells) * 100;
      const boundary = row === 0 || row === cells || column === 0 || column === cells;
      line.push(boundary ? { x, y } : {
        x: x + randomBetween(-5, 5),
        y: y + randomBetween(-5, 5),
      });
    }
    vertices.push(line);
  }

  for (let row = 0; row < cells; row += 1) {
    for (let column = 0; column < cells; column += 1) {
      const points = [
        vertices[row][column],
        vertices[row][column + 1],
        vertices[row + 1][column + 1],
        vertices[row + 1][column],
      ];
      const shard = cloneWithoutCredentials(safeCard) as HTMLElement;
      shard.classList.add("ff-login-shard");
      applyCardGeometry(shard, cardRect.left, cardRect.top, cardRect.width, cardRect.height, cardComputed);
      shard.style.setProperty(
        "clip-path",
        `polygon(${points.map((point) => `${point.x}% ${point.y}%`).join(", ")})`,
        "important",
      );

      const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
      const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
      shard.style.setProperty("--origin-x", `${(centerX / 100) * cardRect.width}px`);
      shard.style.setProperty("--origin-y", `${(centerY / 100) * cardRect.height}px`);

      const outward = Math.atan2(centerY - 50, centerX - 50);
      const direction = Math.hypot(centerX - 50, centerY - 50) < 8
        ? randomBetween(0, Math.PI * 2)
        : outward + randomBetween(-0.65, 0.65);
      const distance = randomBetween(70, 200);
      shard.style.setProperty("--tx", `${Math.cos(direction) * distance}px`);
      shard.style.setProperty("--ty", `${Math.sin(direction) * distance}px`);
      shard.style.setProperty("--ax", `${randomBetween(-1, 1)}`);
      shard.style.setProperty("--ay", `${randomBetween(-1, 1)}`);
      shard.style.setProperty("--az", `${randomBetween(-1, 1)}`);
      shard.style.setProperty("--angle", `${randomBetween(30, 90)}deg`);
      shard.style.setProperty("--shard-delay", `${randomBetween(0, 100)}ms`);
      shard.style.setProperty("--shard-duration", `${randomBetween(600, 700)}ms`);

      // Give every cut edge a highlight, not just pieces on the card perimeter.
      const edge = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      edge.setAttribute("viewBox", "0 0 100 100");
      edge.setAttribute("preserveAspectRatio", "none");
      edge.setAttribute("class", "ff-login-shard-edge");
      const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      polygon.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
      polygon.setAttribute("fill", "none");
      polygon.setAttribute("stroke", "rgba(220, 246, 255, 0.4)");
      polygon.setAttribute("stroke-width", "0.8");
      polygon.setAttribute("vector-effect", "non-scaling-stroke");
      edge.appendChild(polygon);
      shard.appendChild(edge);
      root.appendChild(shard);
    }
  }
}

export function playLoginSuccess(
  card: HTMLElement | null,
  onReveal: () => void,
): LoginSuccessTransition {
  let active = true;
  let navigated = false;
  let overlay: HTMLDivElement | null = null;
  let safeCard: HTMLElement | null = null;
  let cardBounds: DOMRect | null = null;
  let cardComputed: CardMetrics | null = null;
  let pulseCard: HTMLElement | null = null;
  let pulseHalo: HTMLDivElement | null = null;
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
    safeCard = null;
    cardBounds = null;
    cardComputed = null;
    pulseCard = null;
    pulseHalo = null;
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

  const reveal = () => {
    if (!active || navigated) return;
    try {
      if (overlay && safeCard && cardBounds && cardComputed) {
        pulseCard?.remove();
        pulseHalo?.remove();
        pulseCard = null;
        pulseHalo = null;
        createShards(overlay, safeCard, cardBounds, cardComputed);
        overlay.classList.add("is-revealing");
        later(cleanup, REVEAL_CLEANUP_DELAY);
      }
    } catch {
      overlay?.classList.add("is-revealing");
      navigateOnce();
      later(cleanup, 0);
      return;
    }
    navigateOnce();
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

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (reducedMotion || !card || !document.body) {
    card = null;
    later(() => {
      navigateOnce();
      cleanup();
    }, 0);
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
    cardBounds = cardRect;
    cardComputed = cardMetrics;
    safeCard = cloneWithoutCredentials(card) as HTMLElement;

    overlay = document.createElement("div");
    overlay.className = "ff-login-page ff-login-transition";
    overlay.setAttribute("aria-hidden", "true");
    overlay.inert = true;
    const background = copyMainBackground(main, mainRect.width, mainRect.height);
    background.style.left = `${mainRect.left}px`;
    background.style.top = `${mainRect.top}px`;
    overlay.appendChild(background);

    pulseCard = cloneWithoutCredentials(safeCard) as HTMLElement;
    pulseCard.classList.add("ff-login-transition-card-pulse");
    applyCardGeometry(pulseCard, cardRect.left, cardRect.top, cardRect.width, cardRect.height, cardMetrics);
    overlay.appendChild(pulseCard);

    pulseHalo = document.createElement("div");
    pulseHalo.className = "ff-login-transition-halo";
    pulseHalo.setAttribute("aria-hidden", "true");
    pulseHalo.style.left = `${cardRect.left}px`;
    pulseHalo.style.top = `${cardRect.top}px`;
    pulseHalo.style.width = `${cardRect.width}px`;
    pulseHalo.style.height = `${cardRect.height}px`;
    pulseHalo.style.borderRadius = cardMetrics.borderRadius;
    overlay.appendChild(pulseHalo);

    document.body.appendChild(overlay);
    card = null;
    document.addEventListener("visibilitychange", onVisibilityChange);
    later(reveal, PULSE_DURATION);
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
    card = null;
    safeCard = null;
    cardBounds = null;
    cardComputed = null;
    pulseCard = null;
    pulseHalo = null;
    later(() => {
      navigateOnce();
      cleanup();
    }, 0);
  }

  return handle;
}
