export type ChatGif = {
  id: string;
  title: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
};

export type ProviderGif = {
  id?: string; title?: string; rating?: string;
  images?: Record<string, { url?: string; width?: string; height?: string }>;
};

export function giphyApiUrl(path: string, key: string, params: Record<string, string> = {}) {
  if (!/^(?:search|trending|[A-Za-z0-9]{1,64})$/.test(path)) throw new Error("Invalid GIPHY endpoint");
  const url = new URL(`https://api.giphy.com/v1/gifs/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set("api_key", key);
  url.searchParams.set("rating", "g");
  return url;
}

function cdnUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^(?:media\d*|i)\.giphy\.com$/.test(url.hostname)
      && !url.port && !url.username && !url.password && url.pathname.endsWith(".gif") ? value : null;
  } catch { return null; }
}

export function safeGiphyGif(gif: ProviderGif): ChatGif | null {
  if (!gif || gif.rating !== "g" || !gif.id || !/^[A-Za-z0-9]{1,64}$/.test(gif.id)) return null;
  const image = gif.images?.fixed_width ?? gif.images?.original;
  const url = cdnUrl(image?.url);
  if (!url) return null;
  return {
    id: gif.id, title: gif.title || "Animated GIF", url,
    previewUrl: cdnUrl(gif.images?.fixed_width_small?.url) || url,
    width: Math.min(1000, Math.max(1, Number(image?.width) || 200)),
    height: Math.min(1000, Math.max(1, Number(image?.height) || 200)),
  };
}

export const gifTokenPattern = /\[giphy:([A-Za-z0-9]{1,64})\]/g;
export const gifMessage = (id: string) => {
  if (!/^[A-Za-z0-9]{1,64}$/.test(id)) throw new Error("Invalid GIF ID");
  return `[giphy:${id}]`;
};
export function messageGifIds(body: string): string[] {
  return [...new Set([...body.matchAll(new RegExp(gifTokenPattern))].map(match => match[1]))];
}
