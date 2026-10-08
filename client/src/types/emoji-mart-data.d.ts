// The package ships JSON as its default export but only declares its interfaces.
// Keep the default export typed to the actual bundled dataset.
declare module "@emoji-mart/data" {
  export interface Category { id: string; emojis: string[]; }
  export interface Skin { unified: string; native: string; x?: number; y?: number; }
  export interface Emoji {
    id: string;
    name: string;
    keywords: string[];
    skins: Skin[];
    version: number;
    emoticons?: string[];
  }
  export interface Sheet { cols: number; rows: number; }
  export interface EmojiMartData {
    categories: Category[];
    emojis: Record<string, Emoji>;
    aliases: Record<string, string>;
    sheet: Sheet;
  }
  const data: EmojiMartData;
  export default data;
}
