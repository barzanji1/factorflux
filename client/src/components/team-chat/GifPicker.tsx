import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { queryClient } from "@/lib/queryClient";
import { giphyApiUrl, safeGiphyGif, type ChatGif, type ProviderGif } from "@shared/chat-gif";

export async function fetchGifs<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { credentials: "include", signal, cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "GIFs could not be loaded.");
  }
  return response.json();
}
export const gifQueryKey = (id: string) => ["/api/chat/gifs", id];

async function giphyRequest(path: string, params: Record<string, string>, signal?: AbortSignal) {
  const config = await queryClient.fetchQuery({
    queryKey: ["/api/chat/giphy-config"],
    queryFn: () => fetchGifs<{ apiKey: string }>("/api/chat/giphy-config"),
    staleTime: Infinity, retry: false,
  });
  const response = await fetch(giphyApiUrl(path, config.apiKey, params), { signal, cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(response.status === 429 ? "GIPHY rate limit reached. Try again shortly." : "GIPHY could not load GIFs. Please try again.");
  return response.json() as Promise<{ data: ProviderGif | ProviderGif[] }>;
}

export function GiphyAttribution() {
  return <a href="https://giphy.com/" target="_blank" rel="noopener noreferrer"><img src="/images/powered-by-giphy.png" alt="Powered by GIPHY" className="h-auto w-36" /></a>;
}

export function GifPicker({ onSelect, disabled = false }: { onSelect: (gif: ChatGif) => Promise<void>; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [posting, setPosting] = useState(false);
  const [sendError, setSendError] = useState("");
  const searchId = useId();
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const results = useQuery<ChatGif[]>({
    queryKey: ["/api/chat/gifs", "search", query],
    queryFn: async ({ signal }) => {
      const response = await giphyRequest(query ? "search" : "trending", { ...(query ? { q: query } : {}), limit: "24", offset: "0" }, signal);
      if (!Array.isArray(response.data)) throw new Error("GIPHY returned invalid search results.");
      const gifs = response.data.map(safeGiphyGif);
      if (gifs.some(gif => !gif)) throw new Error("GIPHY returned unexpected content. Please try another search.");
      return gifs as ChatGif[];
    },
    enabled: open, retry: false, staleTime: 0, gcTime: 0,
  });
  async function select(gif: ChatGif) {
    if (posting || disabled) return;
    setPosting(true);
    setSendError("");
    try {
      await onSelect(gif);
      setOpen(false);
      queryClient.removeQueries({ queryKey: ["/api/chat/gifs", "search"] });
    } catch (error) { setSendError(error instanceof Error ? error.message : "GIF could not be sent."); }
    finally { setPosting(false); }
  }
  return <Popover open={open} onOpenChange={(value) => { if (!posting) { setOpen(value); setSendError(""); if (!value) queryClient.removeQueries({ queryKey: ["/api/chat/gifs", "search"] }); } }}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" disabled={disabled || posting} aria-label="Choose GIF" data-testid="chat-gif-button" className="ff-team-chat-icon-button h-8 shrink-0 px-1.5 text-[10px] font-bold">GIF</Button>
    </PopoverTrigger>
    <PopoverContent side="top" align="end" className="w-[min(352px,calc(100vw-2rem))] rounded-none bg-[#d4d0c8] p-2" aria-label="GIF picker" data-testid="chat-gif-picker">
      <label className="mb-1 block text-xs font-bold" htmlFor={searchId}>Search GIFs · G-rated only</label>
      <input id={searchId} type="search" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search GIPHY…" className="ff-team-chat-input mb-2 w-full px-2 py-1 text-sm" />
      <div className="h-60 overflow-y-auto border-2 border-[#808080] bg-white p-1" aria-busy={results.isFetching || posting}>
        {(results.isLoading || query !== search.trim()) ? <p role="status" className="p-2 text-xs">Loading GIFs…</p>
          : results.isError ? <div role="alert" className="p-2 text-xs">{results.error.message}<Button size="sm" variant="outline" onClick={() => void results.refetch()} className="mt-2">Retry</Button></div>
            : !results.data?.length ? <p className="p-2 text-xs">No G-rated GIFs found.</p>
              : <div className="grid grid-cols-2 gap-1">{results.data.map(gif => <button key={gif.id} type="button" disabled={posting || disabled} onClick={() => void select(gif)} aria-label={`Send GIF: ${gif.title}`} data-testid={`chat-gif-${gif.id}`} className="border-2 border-transparent p-0.5 hover:border-[#098b9f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#098b9f] disabled:opacity-50">
                <img src={gif.previewUrl} alt={gif.title} loading="lazy" referrerPolicy="no-referrer" className="h-24 w-full object-contain" />
              </button>)}</div>}
      </div>
      {sendError && <p role="alert" className="mt-1 text-xs text-[#8b3030]">{sendError}</p>}
      <div className="mt-2 flex justify-between"><GiphyAttribution /><span className="text-[10px]">{posting ? "Sending…" : "Select a GIF to send"}</span></div>
    </PopoverContent>
  </Popover>;
}

export function InlineGif({ id }: { id: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const gif = useQuery<ChatGif>({
    queryKey: gifQueryKey(id), queryFn: async ({ signal }) => {
      const response = await giphyRequest(id, {}, signal);
      const value = !Array.isArray(response.data) ? safeGiphyGif(response.data) : null;
      if (!value || value.id !== id) throw new Error("GIF unavailable.");
      return value;
    },
    staleTime: 0, gcTime: 0, retry: false,
  });
  return <span className="my-1 inline-flex max-w-full flex-col gap-1 whitespace-normal align-middle" data-testid="chat-inline-gif">
    {gif.data && !imageFailed
      ? <img src={gif.data.url} alt={gif.data.title} width={gif.data.width} height={gif.data.height} loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="max-h-64 max-w-full rounded-none object-contain" />
      : gif.isError || imageFailed ? <span className="text-xs">GIF unavailable. <button type="button" className="underline" onClick={() => { setImageFailed(false); void gif.refetch(); }}>Retry</button></span>
        : <span className="text-xs">Loading GIF…</span>}
    <GiphyAttribution />
  </span>;
}
