import test from "node:test";
import assert from "node:assert/strict";
import { getSidebarState, subscribeSidebarState, setSidebarHovered, toggleSidebarSection, requestSidebarFocus, consumeSidebarFocus } from "./sidebar-state";

test("expanded hover survives a new page subscriber without an intermediate collapse", () => {
  let notifications = 0;
  const unsubscribe = subscribeSidebarState(() => notifications++);
  setSidebarHovered(true);
  const beforeNavigation = getSidebarState();
  unsubscribe();
  const nextUnsubscribe = subscribeSidebarState(() => notifications++);
  assert.equal(getSidebarState(), beforeNavigation);
  assert.equal(getSidebarState().hovered, true);
  setSidebarHovered(true);
  assert.equal(notifications, 1, "unchanged hover must not restart transitions");
  setSidebarHovered(false);
  assert.equal(getSidebarState().hovered, false);
  assert.equal(notifications, 2);
  nextUnsubscribe();
});

test("group choices survive navigation and mobile groups stay independent", () => {
  toggleSidebarSection("desktop", "Funding");
  assert.equal(getSidebarState().sections.desktop.Funding, false);
  assert.equal(getSidebarState().sections.mobile.Funding, undefined);
  toggleSidebarSection("mobile", "Workspace");
  assert.equal(getSidebarState().sections.desktop.Funding, false);
  assert.equal(getSidebarState().sections.mobile.Workspace, false);
  toggleSidebarSection("desktop", "Funding");
  assert.equal(getSidebarState().sections.desktop.Funding, true);
});

test("keyboard focus transfers once, only to the destination page", () => {
  requestSidebarFocus("/invoices");
  assert.equal(consumeSidebarFocus("/reports"), false);
  assert.equal(consumeSidebarFocus("/invoices"), true);
  assert.equal(consumeSidebarFocus("/invoices"), false);
});
