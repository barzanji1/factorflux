import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createGiphyService, GiphyError } from "./giphy";
import { giphyApiUrl, safeGiphyGif, gifMessage, messageGifIds } from "../../shared/chat-gif";

const fixture = (rating = "g", url = "https://media2.giphy.com/media/safe123/giphy.gif?cid=keep&ep=v1") => ({
  id: "safe123", title: "Safe animation", rating,
  images: { fixed_width: { url, width: "200", height: "120" } },
});
test("every search, trending and ID request locks rating=g, even if overridden", () => {
  for (const endpoint of ["search", "trending", "safe123"]) {
    const url = giphyApiUrl(endpoint, "fixture-only", { q: "trucks", rating: "r" });
    assert.equal(url.origin, "https://api.giphy.com");
    assert.equal(url.searchParams.get("rating"), "g");
  }
  assert.throws(() => giphyApiUrl("../anything", "fixture-only"));
});
test("only HTTPS GIPHY CDN animations are accepted; media query strings stay untouched", () => {
  assert.equal(safeGiphyGif(fixture())?.url, fixture().images.fixed_width.url);
  for (const rating of ["pg", "pg-13", "r", ""]) assert.equal(safeGiphyGif(fixture(rating)), null);
  for (const url of ["http://media.giphy.com/a.gif", "https://giphy.com.evil.test/a.gif",
    "https://bucket.s3.amazonaws.com/a.gif", "https://media.giphy.com:8080/a.gif",
    "https://media.giphy.com/a.mp4", "javascript:alert(1)"]) {
    assert.equal(safeGiphyGif(fixture("g", url)), null);
  }
});
test("message tokens retain only IDs, work beside mentions/text, and deduplicate validations", async () => {
  const requests: URL[] = [];
  const service = createGiphyService({ apiKey: () => "fixture-only", fetcher: async input => {
    requests.push(new URL(String(input)));
    return new Response(JSON.stringify({ data: fixture() }));
  } });
  await service.validateMessage(`@maria ${gifMessage("safe123")} ${gifMessage("safe123")}`);
  assert.deepEqual(messageGifIds("[giphy:safe123] with text"), ["safe123"]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get("rating"), "g");
  assert.throws(() => gifMessage("../bad"));
});
test("server rejects non-G single-ID responses even when GIPHY ignores the rating parameter", async () => {
  const service = createGiphyService({ apiKey: () => "fixture-only", fetcher: async () =>
    new Response(JSON.stringify({ data: fixture("r") })) });
  await assert.rejects(() => service.validateMessage("[giphy:safe123]"),
    error => error instanceof GiphyError && error.statusCode === 400);
});
test("missing key, provider failures, quota errors and malformed responses fail visibly without leaking keys", async () => {
  await assert.rejects(() => createGiphyService({ apiKey: () => undefined }).get("safe123"), /not configured/);
  for (const fetcher of [
    async () => new Response("bad", { status: 429 }),
    async () => new Response("bad", { status: 500 }),
    async () => new Response("not JSON"),
    async () => { throw new Error("fixture-secret-key must not leak"); },
  ]) {
    const service = createGiphyService({ apiKey: () => "fixture-secret-key", fetcher });
    await assert.rejects(() => service.get("safe123"), error =>
      error instanceof GiphyError && !error.message.includes("fixture-secret-key"));
  }
});
test("text-only chat does not call GIPHY; GIF batches have a bounded validation cost", async () => {
  let calls = 0;
  const service = createGiphyService({ fetcher: async () => { calls++; throw new Error("not expected"); } });
  await service.validateMessage("Ordinary chat and @mentions");
  await assert.rejects(() => service.validateMessage("[giphy:a][giphy:b][giphy:c][giphy:d][giphy:e]"), /at most four/);
  assert.equal(calls, 0);
});
test("GIF config is chat-authorized, not logged, and shared renderer covers channels and thread replies", async () => {
  const routes = await fs.readFile("server/routes.ts", "utf8");
  assert.match(routes, /app\.get\("\/api\/chat\/giphy-config", chatPermission/);
  assert.match(routes, /await giphy\.validateMessage\(req\.body\.body\)/);
  assert.match(await fs.readFile("server/index.ts", "utf8"), /key === "apiKey" \? undefined/);
  assert.match(await fs.readFile("client/src/components/team-chat/MessageBody.tsx", "utf8"), /InlineGif/);
  for (const path of ["client/src/pages/chat.tsx", "client/src/components/team-chat/ThreadPanel.tsx"]) {
    assert.match(await fs.readFile(path, "utf8"), /<GifPicker/);
  }
});
