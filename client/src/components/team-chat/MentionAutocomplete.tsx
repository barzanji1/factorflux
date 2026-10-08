import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

export type ChatUser = {
  id: string | number;
  name: string;
  email?: string;
  role?: string;
  handle: string;
};

type MentionAutocompleteProps = {
  value: string;
  onChange: (value: string) => void;
  users: ChatUser[];
  placeholder: string;
  className?: string;
  rows?: number;
  textareaRef?: (node: HTMLTextAreaElement | null) => void;
  onSubmit: () => void;
  disabled?: boolean;
  onDirectoryRefresh?: () => void;
  "data-testid"?: string;
};

const cleanHandle = (handle: string) => handle.replace(/^@+/, "");

export function MentionAutocomplete({
  value, onChange, users, placeholder, className, rows = 1, textareaRef, onSubmit, disabled, onDirectoryRefresh, "data-testid": testId,
}: MentionAutocompleteProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const listboxId = useId();
  const lastMentionTriggerRef = useRef<number | null>(null);
  const [activeQuery, setActiveQuery] = useState<{ start: number; end: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = useMemo(() => {
    if (!activeQuery) return [];
    const query = activeQuery.query.toLowerCase();
    return users.filter((user) => cleanHandle(user.handle).toLowerCase().includes(query)
      || user.name.toLowerCase().includes(query)).slice(0, 8);
  }, [activeQuery, users]);

  const setRef = (node: HTMLTextAreaElement | null) => {
    inputRef.current = node;
    textareaRef?.(node);
  };

  const inspectCaret = (text: string, caret: number) => {
    const beforeCaret = text.slice(0, caret);
    const match = beforeCaret.match(/(^|[\s([{])@([a-zA-Z0-9._-]*)$/);
    if (!match) {
      setActiveQuery(null);
      setActiveIndex(0);
      lastMentionTriggerRef.current = null;
      return;
    }
    const triggerStart = caret - match[2].length - 1;
    if (lastMentionTriggerRef.current !== triggerStart) onDirectoryRefresh?.();
    lastMentionTriggerRef.current = triggerStart;
    setActiveQuery({ start: triggerStart, end: caret, query: match[2] });
    setActiveIndex(0);
  };

  const choose = (user: ChatUser) => {
    if (!activeQuery) return;
    const handle = cleanHandle(user.handle);
    const before = value.slice(0, activeQuery.start);
    const after = value.slice(activeQuery.end);
    const suffix = after.startsWith(" ") ? "" : " ";
    const next = `${before}@${handle}${suffix}${after}`;
    const caret = before.length + handle.length + 1 + suffix.length;
    onChange(next);
    setActiveQuery(null);
    lastMentionTriggerRef.current = null;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" && activeQuery) {
      event.preventDefault();
      setActiveQuery(null);
      lastMentionTriggerRef.current = null;
      return;
    }
    if (activeQuery && matches.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        choose(matches[activeIndex]);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <textarea
        ref={setRef}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
          inspectCaret(event.target.value, event.target.selectionStart);
        }}
        onFocus={onDirectoryRefresh}
        onClick={(event) => inspectCaret(value, event.currentTarget.selectionStart)}
        onKeyUp={(event) => inspectCaret(value, event.currentTarget.selectionStart)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={Boolean(activeQuery && matches.length)}
        aria-controls={listboxId}
        aria-activedescendant={activeQuery && matches.length ? `${listboxId}-option-${activeIndex}` : undefined}
        data-testid={testId}
        className={className}
      />
      {activeQuery && matches.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Mention a teammate"
          className="absolute bottom-[calc(100%+0.35rem)] left-0 z-50 max-h-56 w-[min(20rem,90vw)] overflow-auto border-2 border-[#808080] bg-[#efeee9] p-1 shadow-[2px_2px_0_#777]"
        >
          {matches.map((user, index) => (
            <li
              key={user.id}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(user)}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs ${index === activeIndex ? "bg-[#dff5f6]" : "hover:bg-[#e5e3dc]"}`}
            >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#8bbfc1] text-[9px] font-bold text-[#154c51]">
                  {user.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-[#222]">{user.name}</span>
                  <span className="block truncate font-mono text-[10px] text-[#17626a]">@{cleanHandle(user.handle)}</span>
                </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
