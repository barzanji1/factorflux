import sharp from "sharp";
import { giphyApiUrl, safeGiphyGif, type ProviderGif } from "../shared/chat-gif";
import { createGiphyService } from "../server/services/giphy";

// Read-only provider verification: no chat messages, bucket writes, or saved media.
async function main() {
  const key = process.env.GIPHY_API_KEY;
  if (!key) throw new Error("GIPHY_API_KEY is not configured.");
  const response = await fetch(giphyApiUrl("search", key, { q: "truck celebration", limit: "3" }), { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`GIPHY search HTTP ${response.status}`);
  const result = await response.json() as { data: ProviderGif[] };
  if (!Array.isArray(result.data) || !result.data.length) throw new Error("GIPHY returned no results.");
  if (result.data.some(gif => !safeGiphyGif(gif))) throw new Error("GIPHY returned content outside the G-rated CDN policy.");
  const gif = await createGiphyService().get(result.data[0].id!);
  const media = await fetch(gif.url, { signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!media.ok) throw new Error(`GIPHY CDN HTTP ${media.status}`);
  const metadata = await sharp(Buffer.from(await media.arrayBuffer()), { animated: true }).metadata();
  console.log(JSON.stringify({ search: "passed", results: result.data.length, allRatings: "g",
    serverValidation: "passed", cdnHost: new URL(gif.url).hostname,
    mediaFormat: metadata.format, animationFrames: metadata.pages ?? 1,
    storedMedia: false, postedMessages: false }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "GIPHY verification failed"); process.exitCode = 1; });
