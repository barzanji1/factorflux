import type { ReactNode } from "react";
import { InlineGif } from "./GifPicker";

export type MessageMention = { userId: string | number; handle: string; start: number; end: number };

const emojiSources: Record<string, { src: string; label: string }> = {
  "tpf-logo": { src: "/emojis/tpf-logo.png", label: "TPF Logo" },
  "ff-logo": { src: "/emojis/ff-logo.png", label: "FactorFlux Logo" },
  tpf4life: { src: "/emojis/tpf4life.png", label: "TPF 4Life" },
  "gm-tpf": { src: "/emojis/gm-tpf.png", label: "GM TPF" },
  "tpf-truck": { src: "/emojis/tpf-truck.png", label: "TPF Truck" },
  funded: { src: "/emojis/funded.png", label: "Funded" },
  invoice: { src: "/emojis/invoice.png", label: "Invoice" },
  approved: { src: "/emojis/approved.png", label: "Approved" },
};
const emojiPattern = /:(tpf-logo|ff-logo|tpf4life|gm-tpf|tpf-truck|funded|invoice|approved):/g;

function renderSegment(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\[giphy:[A-Za-z0-9]{1,64}\])/g).flatMap((segment, partIndex) => {
    const gif = /^\[giphy:([A-Za-z0-9]{1,64})\]$/.exec(segment);
    if (gif) return [<InlineGif key={`${keyPrefix}-gif-${partIndex}`} id={gif[1]} />];
    return segment.split(emojiPattern).map((part, index) => {
    const emoji = emojiSources[part];
    return emoji
      ? <img key={`${keyPrefix}-${partIndex}-${index}`} src={emoji.src} alt={`:${part}:`} title={emoji.label} className="mx-0.5 inline-block h-6 w-6 align-middle object-contain" />
      : part;
    });
  });
}

export function MessageBody({
  body, mentions = [], channelId, rootMessageId,
}: {
  body: string;
  mentions?: MessageMention[];
  channelId?: string | number;
  rootMessageId?: string | number;
}) {
  const validMentions = mentions
    .filter((mention) => Number.isInteger(mention.start) && Number.isInteger(mention.end)
      && mention.start >= 0 && mention.end > mention.start && mention.end <= body.length)
    .sort((a, b) => a.start - b.start);
  const output: ReactNode[] = [];
  let cursor = 0;
  validMentions.forEach((mention, index) => {
    if (mention.start < cursor) return;
    output.push(...renderSegment(body.slice(cursor, mention.start), `text-${index}`));
    const target = `/chat?channelId=${encodeURIComponent(String(channelId ?? ""))}&messageId=${encodeURIComponent(String(rootMessageId ?? ""))}`;
    output.push(
      <a
        key={`mention-${index}`}
        href={target}
        onClick={(event) => {
          if (!channelId || !rootMessageId) return;
          event.preventDefault();
          window.dispatchEvent(new CustomEvent("team-chat:open", { detail: { channelId, messageId: rootMessageId } }));
          window.history.pushState({}, "", target);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }}
        className="rounded-sm bg-[#fff0b8] px-0.5 font-semibold text-[#684c08] underline decoration-[#c19a33] underline-offset-2"
        data-testid="chat-mention-link"
      >
        {body.slice(mention.start, mention.end)}
      </a>,
    );
    cursor = mention.end;
  });
  output.push(...renderSegment(body.slice(cursor), "tail"));
  return <>{output}</>;
}
