---
name: Document compression
description: Compression provenance, portal storage coverage, and HEIC portability constraints.
---

The user requires automatic compression above the configurable threshold, storing the compressed version rather than a second original object. Preserve original/stored size provenance in both staff documents and portal submission documents.

**Why:** Portal paperwork has a separate storage lifecycle; recording sizes only for staff documents would silently lose the user's requested compression information.

**How to apply:** Keep the visible compression line consistent wherever either kind of document appears. Do not impose the compression threshold as a rejection limit, including PDFs that remain large after both compression presets.

Do not assume the bundled image library can decode HEIC simply because it advertises HEIF support.

**Why:** The installed Sharp build advertises AVIF input but requires the system libheif decoder for HEIC. Real HEIC conversion was verified with that decoder.

**How to apply:** Preserve the system decoding dependency for deployments as well as previews; test an actual HEIC when changing image-library dependencies.
