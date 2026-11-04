import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { queryClient } from "@/lib/queryClient";
import { NeuButton } from "@/styles/neu/components";
import { NeuNotice } from "@/components/shared/NeuNotice";
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
      <NeuButton type="button" disabled={disabled || posting} aria-label="Choose GIF" data-testid="chat-gif-button" className="!min-h-9 shrink-0 !rounded-lg !px-2 text-[10px] font-bold text-[#208894]">GIF</NeuButton>
    </PopoverTrigger>
    <PopoverContent side="top" align="end" className="w-[min(352px,calc(100vw-2rem))] rounded-2xl border-0 bg-[#e0e0e0] p-3 text-[#333] shadow-[-8px_-8px_18px_#fff,8px_8px_18px_#b8b8b8]" aria-label="GIF picker" data-testid="chat-gif-picker">
      <div className="mb-2 flex items-center justify-between gap-2"><label className="block text-xs font-bold" htmlFor={searchId}>Search GIFs · G-rated only</label><NeuButton type="button" onClick={() => setOpen(false)} aria-label="Close GIF picker" className="!min-h-7 !w-7 !rounded-lg !p-0"><X className="h-3.5 w-3.5" /></NeuButton></div>
      <input id={searchId} type="search" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search GIPHY…" className="mb-2 w-full rounded-xl border-0 bg-[#e0e0e0] px-3 py-2 text-sm text-[#333] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff] outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8]" />
      <div className="h-60 overflow-y-auto rounded-xl bg-[#e0e0e0] p-2 shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]" aria-busy={results.isFetching || posting}>
        {(results.isLoading || query !== search.trim()) ? <p role="status" className="p-2 text-xs">Loading GIFs…</p>
          : results.isError ? <NeuNotice severity="block" role="alert" className="text-xs">{results.error.message}<NeuButton onClick={() => void results.refetch()} className="mt-2 !min-h-8 !rounded-lg !px-3 text-xs">Retry</NeuButton></NeuNotice>
            : !results.data?.length ? <p className="p-2 text-xs">No G-rated GIFs found.</p>
              : <div className="grid grid-cols-2 gap-2">{results.data.map(gif => <button key={gif.id} type="button" disabled={posting || disabled} onClick={() => void select(gif)} aria-label={`Send GIF: ${gif.title}`} data-testid={`chat-gif-${gif.id}`} className="rounded-lg p-1 transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#27aab8] disabled:opacity-50">
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
