import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { attachStaffLoginRipples } from "./use-staff-login-ripples";

class Surface extends EventTarget {
  children: Surface[] = [];
  parent: Surface | null = null;
  className = "";
  clientLeft = 1;
  clientTop = 1;
  style: Record<string, unknown> = {
    setProperty: (key: string, value: string) => { this.style[key] = value; },
  };
  setAttribute() {}
  getBoundingClientRect() { return { left: 100, top: 50, width: 516, height: 503 }; }
  appendChild(child: Surface) { child.parent = this; this.children.push(child); }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
}

function pointer(surface: Surface, type: string, x = 160, y = 130, time = 0, pointerType = "mouse") {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: x }, clientY: { value: y },
    timeStamp: { value: time }, pointerType: { value: pointerType },
  });
  surface.dispatchEvent(event);
  return event;
}

let face: Surface;
let preference: EventTarget & { matches: boolean };
let busy: { current: boolean };
let transitioning: { current: boolean };
let cleanup: (() => void) | undefined;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
beforeEach(() => {
  face = new Surface();
  preference = Object.assign(new EventTarget(), { matches: false });
  busy = { current: false };
  transitioning = { current: false };
  Object.assign(globalThis, {
    window: { matchMedia: () => preference },
    document: { createElement: () => new Surface() },
  });
  cleanup = attachStaffLoginRipples(face as unknown as HTMLDivElement, transitioning, busy);
});
afterEach(() => {
  cleanup?.();
  Object.assign(globalThis, { window: originalWindow, document: originalDocument });
});

test("centers three rings inside the actual card border", () => {
  pointer(face, "pointerenter");
  assert.equal(face.children.length, 1);
  assert.equal(face.children[0].style.left, "59px");
  assert.equal(face.children[0].style.top, "79px");
  assert.equal(face.children[0].children.length, 3);
});
test("requires both sufficient movement and elapsed time", () => {
  pointer(face, "pointerenter");
  pointer(face, "pointermove", 165, 130, 200);
  pointer(face, "pointermove", 230, 130, 100);
  assert.equal(face.children.length, 1);
  pointer(face, "pointermove", 230, 130, 200);
  assert.equal(face.children.length, 2);
});
test("allows repeated touch presses without intercepting the event; retains at most four", () => {
  for (let i = 0; i < 7; i++) assert.equal(pointer(face, "pointerdown", 160, 130, i, "touch").defaultPrevented, false);
  assert.equal(face.children.length, 4);
  assert(face.children.every(child => child.className.includes("--press")));
});
test("removes finished ripples and detaches listeners on cleanup", () => {
  pointer(face, "pointerdown");
  face.children[0].dispatchEvent(Object.assign(new Event("animationend"), { animationName: "staff-login-ripple-lifetime" }));
  assert.equal(face.children.length, 0);
  pointer(face, "pointerenter");
  cleanup?.();
  pointer(face, "pointerdown");
  assert.equal(face.children.length, 0);
});
test("clears and suppresses all motion immediately on preference change", () => {
  pointer(face, "pointerenter");
  preference.dispatchEvent(Object.assign(new Event("change"), { matches: true }));
  pointer(face, "pointerdown");
  assert.equal(face.children.length, 0);
});
test("suppresses touch hover and interaction during authentication or transition", () => {
  pointer(face, "pointerenter", 160, 130, 0, "touch");
  busy.current = true;
  pointer(face, "pointerdown");
  busy.current = false;
  transitioning.current = true;
  pointer(face, "pointerdown");
  assert.equal(face.children.length, 0);
});
test("does not react to form controls or secondary mouse buttons", () => {
  Object.assign(face, { closest: () => ({}) });
  pointer(face, "pointerdown");
  assert.equal(face.children.length, 0);
  Object.assign(face, { closest: () => null });
  const event = new Event("pointerdown");
  Object.defineProperty(event, "button", { value: 2 });
  face.dispatchEvent(event);
  assert.equal(face.children.length, 0);
  Object.assign(document, { elementFromPoint: () => ({ closest: () => ({}) }) });
  pointer(face, "pointerenter");
  assert.equal(face.children.length, 0);
});
