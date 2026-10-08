---
name: TypeScript target semantics
description: Vite class-field behavior can change when the TypeScript target changes, despite noEmit.
---

Treat TypeScript target changes as potentially runtime-relevant, not automatically type-only.

**Why:** This project's Vite loader injects `useDefineForClassFields: false` when both that flag and the target are unspecified. Setting the target to ES2022 removes that fallback and changes frontend class fields from constructor assignments to define-style fields. `noEmit: true` only prevents TypeScript's own emission; Vite still reads the configuration.

**How to apply:** When auditing or changing the target, check the installed Vite implementation and compare transformed class output. The user chose to preserve earlier assignment-style fields while retaining ES2022 support; keep that behavior unless they explicitly request a change. Do not silently change compiler settings during an audit.
