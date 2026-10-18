---
name: GIPHY integration policy
description: Provider-required browser calls, attribution, G-only content, and no media storage.
---

Team Chat GIFs must be G-rated, animate inline, embed directly from GIPHY's CDN, and show the official Powered by GIPHY attribution. Do not store GIF media in the application's bucket.

**Why:** These are the user's explicit requirements.

**How to apply:** Lock G on every GIPHY API request and independently reject non-G single-ID metadata before accepting a GIF message. Provider single-ID lookups can ignore the request's rating parameter.

Use direct browser requests for GIPHY search/display APIs, retain returned media URLs and query parameters unchanged, and do not persist media copies or URL caches.

**Why:** GIPHY's integration guidelines prohibit API/media proxying and unapproved media caching. Its client API key is intended to be available to the browser; this differs from private account/admin credentials.

**How to apply:** Make client configuration available only to authenticated chat users, redact the key from application response logs, preserve official attribution assets, and do not replace browser delivery with a server proxy as a supposed key-hiding fix.
