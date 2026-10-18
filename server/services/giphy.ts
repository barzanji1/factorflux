import { giphyApiUrl, messageGifIds, safeGiphyGif, type ChatGif, type ProviderGif } from "../../shared/chat-gif";

export class GiphyError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

export function createGiphyService({
  apiKey = () => process.env.GIPHY_API_KEY,
  fetcher = fetch,
}: { apiKey?: () => string | undefined; fetcher?: typeof fetch } = {}) {
  async function request(path: string, params: Record<string, string> = {}) {
    const key = apiKey();
    if (!key) throw new GiphyError(503, "GIF picker is unavailable: GIPHY is not configured.");
    const url = giphyApiUrl(path, key, params);
    let response: Response;
    try { response = await fetcher(url, { signal: AbortSignal.timeout(8000) }); }
    catch { throw new GiphyError(502, "GIPHY could not be reached. Please try again."); }
    if (!response.ok) throw new GiphyError(response.status === 429 ? 503 : 502,
      response.status === 429 ? "GIPHY rate limit reached. Please try again shortly." : "GIPHY could not load GIFs. Please try again.");
    try { return await response.json() as { data: ProviderGif | ProviderGif[] }; }
    catch { throw new GiphyError(502, "GIPHY returned an invalid response."); }
  }
  async function get(id: string): Promise<ChatGif> {
    if (!/^[A-Za-z0-9]{1,64}$/.test(id)) throw new GiphyError(400, "Invalid GIF ID");
    const response = await request(id);
    if (!response.data || Array.isArray(response.data)) throw new GiphyError(502, "GIPHY returned an invalid GIF.");
    // Single-ID requests may ignore rating=g; verify the response before storing any token.
    const gif = safeGiphyGif(response.data);
    if (!gif || gif.id !== id) throw new GiphyError(400, "Only G-rated GIPHY GIFs can be posted.");
    return gif;
  }
  return {
    get,
    async validateMessage(body: unknown) {
      if (typeof body !== "string") return;
      const ids = messageGifIds(body);
      if (ids.length > 4) throw new GiphyError(400, "Send at most four GIFs per message.");
      await Promise.all(ids.map(get));
    },
  };
}
export const giphy = createGiphyService();
