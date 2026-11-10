import Picker from "@emoji-mart/react";
import emojiData from "@emoji-mart/data";

const custom = [
  { id: "tpf-logo", name: "TPF Logo", keywords: ["tpf", "logo"], skins: [{ src: "/emojis/tpf-logo.png" }] },
  { id: "ff-logo", name: "FactorFlux Logo", keywords: ["factorflux", "ff", "logo"], skins: [{ src: "/emojis/ff-logo.png" }] },
  { id: "tpf4life", name: "TPF 4Life", keywords: ["tpf", "4life"], skins: [{ src: "/emojis/tpf4life.png" }] },
  { id: "gm-tpf", name: "GM TPF", keywords: ["good morning", "tpf", "wave"], skins: [{ src: "/emojis/gm-tpf.png" }] },
  { id: "tpf-truck", name: "TPF Truck", keywords: ["tpf", "truck"], skins: [{ src: "/emojis/tpf-truck.png" }] },
  { id: "funded", name: "Funded", keywords: ["funded", "money", "dollar"], skins: [{ src: "/emojis/funded.png" }] },
  { id: "invoice", name: "Invoice", keywords: ["invoice", "document"], skins: [{ src: "/emojis/invoice.png" }] },
  { id: "approved", name: "Approved", keywords: ["approved", "check"], skins: [{ src: "/emojis/approved.png" }] },
];
const data = {
  ...emojiData,
  categories: [{ id: "tpf", name: "TPF", emojis: custom.map(emoji => emoji.id) }, ...emojiData.categories],
  emojis: { ...Object.fromEntries(custom.map(emoji => [emoji.id, emoji])), ...emojiData.emojis },
};

export default function EmojiPicker({ onEmojiSelect }: { onEmojiSelect: (emoji: { id?: string; native?: string }) => void }) {
  return <Picker data={data} dynamicWidth onEmojiSelect={onEmojiSelect}
    categories={["tpf", "frequent", "people", "nature", "foods", "activity", "places", "objects", "symbols"]}
    categoryIcons={{ tpf: { src: "/emojis/tpf-logo.png" } }} previewPosition="none"
    skinTonePosition="search" width="100%" height={380} />;
}
