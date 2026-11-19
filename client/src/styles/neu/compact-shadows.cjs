// Keep older one-off Tailwind shadow utilities on the shared compact scale.
// Transform declarations, not selectors: hover/pressed/focus variants retain
// their own behavior and never override a component's unrelated styles.
function hexRgb(color) {
  const hex = color.slice(1);
  const expanded = hex.length === 3 ? [...hex].map(char => char + char).join("") : hex;
  if (expanded.length !== 6) return null;
  return [0, 2, 4].map(offset => parseInt(expanded.slice(offset, offset + 2), 16));
}

function compactShadow(value) {
  const parts = [...value.matchAll(/(inset\s+)?((?:-?\d+(?:\.\d+)?px\s+){2,4})(#[a-f0-9]{3,8})\b/gi)].map(match => ({
    match, inset: Boolean(match[1]), dimensions: match[2].trim().split(/\s+/).map(parseFloat), rgb: hexRgb(match[3]),
  }));
  const replacements = new Map();
  for (const dark of parts) {
    if (!dark.rgb || dark.match[3].toLowerCase() === "#c8c8c8") continue; // Already on the shared scale.
    if (Math.max(...dark.rgb) - Math.min(...dark.rgb) > 20 ||
        Math.min(...dark.rgb) < 110 || Math.max(...dark.rgb) > 215) continue;
    const light = parts.find(part => part.rgb && Math.min(...part.rgb) >= 240 &&
      part.inset === dark.inset && part.dimensions[0] * dark.dimensions[0] < 0 &&
      part.dimensions[1] * dark.dimensions[1] < 0 && part.dimensions[2] > 0 && dark.dimensions[2] > 0);
    if (!light) continue; // Leave focus rings, colored glows, plain drops and zero-blur bevels alone.
    for (const part of [dark, light]) {
      const limits = part.inset ? [3, 3, 6, 3] : [4, 4, 8, 4];
      const dimensions = part.dimensions.map((number, index) =>
        `${Math.sign(number) * Math.min(Math.abs(number) / 2, limits[index])}px`).join(" ");
      replacements.set(part.match.index, `${part.inset ? "inset " : ""}${dimensions} ${part === dark ? "#c8c8c8" : part.match[3]}`);
    }
  }
  let result = value;
  for (const part of [...parts].reverse()) {
    const replacement = replacements.get(part.match.index);
    if (replacement) result = result.slice(0, part.match.index) + replacement + result.slice(part.match.index + part.match[0].length);
  }
  return result;
}

const AUTHENTICATED_SELECTORS = [
  ".ff-", ".qc-card", ".qc-button-", ".qc-topbar-search", "[data-button-variant",
  ".bevel-button",
];

const PRESERVE_SEMANTIC_COLORS = [
  ".ff-auth", ".ff-login", ".ff-portal-shell", ".status-",
  ".ff-admin-role-", ".ff-expenses-category-", ".ff-expenses-status-",
  ".ff-payroll-action-paid", ".ff-rules-type", ".ff-rules-priority",
  ".ff-workflow-auto", ".ff-workflow-gated", "[data-status",
  'button[class*="bg-blue-"]', 'button[class*="bg-amber-"]',
];

function sourceName(declaration) {
  return declaration.source?.input?.file?.replace(/\\/g, "/").split("/").pop() ?? "";
}

function isDarkRule(selector) {
  return /\[\s*data-theme\s*=\s*["']?dark["']?\s*\]/i.test(selector) ||
    /(^|[\s,(>+~])\.dark(?=$|[\s.:#\[>+~,)])/i.test(selector);
}

function isAuthenticatedRule(declaration) {
  const file = sourceName(declaration);
  const selector = declaration.parent?.selector ?? "";
  const normalizedSelector = selector.toLowerCase();
  if (isDarkRule(selector) || normalizedSelector.includes("badge") ||
      normalizedSelector.includes("status") || normalizedSelector.includes("[data-status")) return false;

  if (file === "dashboard.css" || file === "ff-financial-dashboard.css") {
    return !PRESERVE_SEMANTIC_COLORS.some(marker => selector.includes(marker));
  }
  if (file === "ff-institutional-workspace.css") {
    return selector.includes(".ff-institutional-root") ||
      selector.includes("body:has(.ff-institutional-root");
  }
  if (file !== "index.css") return false;
  return AUTHENTICATED_SELECTORS.some(marker => selector.includes(marker)) &&
    !PRESERVE_SEMANTIC_COLORS.some(marker => selector.includes(marker));
}

function parseNeutralColor(color) {
  const hex = color.match(/^#([a-f\d]{3}|[a-f\d]{6})$/i);
  if (hex) {
    const value = hex[1].length === 3 ? [...hex[1]].map(char => char + char).join("") : hex[1];
    return {
      channels: [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16)),
      alpha: null,
    };
  }
  const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+%?))?\s*\)$/i);
  if (rgb) {
    return {
      channels: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])],
      alpha: rgb[4] ?? null,
    };
  }
  return null;
}

function tokenName(category, color) {
  const encoded = Array.from(color.toLowerCase())
    .map(character => character.codePointAt(0).toString(16))
    .join("_");
  return `--ff-darkable-${category}-${encoded}`;
}

function withAlpha(color, alpha) {
  if (alpha === null) return color;
  const channels = color.match(/^#([a-f\d]{6})$/i)?.[1];
  if (!channels) return color;
  return `rgba(${parseInt(channels.slice(0, 2), 16)},${parseInt(channels.slice(2, 4), 16)},${parseInt(channels.slice(4, 6), 16)},${alpha})`;
}

function tokenizedColors(value, category, tokenValues) {
  return value.replace(/#[a-f\d]{3,8}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/gi, color => {
    const parsedColor = parseNeutralColor(color);
    if (!parsedColor) return color;
    const rgb = parsedColor.channels;
    const chromaLimit = category === "shadow" ? 48 : 30;
    if (Math.max(...rgb) - Math.min(...rgb) > chromaLimit) return color;
    // Pure white foregrounds carry meaning on accent/status controls; only
    // surface, border and shadow declarations should ever tokenize that value.
    if (category === "text" && rgb.every(channel => channel > 245)) return color;
    const luminance = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    let darkValue;
    if (category === "shadow") {
      // Opaque legacy bevels become the two requested ambient colors. Existing
      // rgba() values retain their authored opacity instead of gaining weight.
      darkValue = luminance > 220 ? "#ffffff" : "#000000";
      darkValue = withAlpha(darkValue, parsedColor.alpha ?? (luminance > 220 ? "0.05" : "0.5"));
    } else if (category === "text") {
      darkValue = luminance < 150 ? "#e8e8e8" : "#a0a0a0";
    } else if (category === "border") {
      darkValue = luminance < 145 ? "#3a3a3a" : "#333333";
    } else if (luminance >= 245) {
      darkValue = "#242424";
    } else if (luminance >= 215) {
      darkValue = "#1a1a1a";
    } else {
      darkValue = "#242424";
    }
    darkValue = withAlpha(darkValue, parsedColor.alpha);
    const key = tokenName(category, color);
    tokenValues.set(key, { light: color, dark: darkValue });
    return `var(${key})`;
  });
}

function compactNeumorphicShadows() {
  const tokenValues = new Map();
  return {
    postcssPlugin: "compact-neumorphic-shadows",
    Declaration(declaration) {
      if (declaration.prop === "box-shadow" || declaration.prop === "--tw-shadow") {
        const compact = compactShadow(declaration.value);
        if (compact !== declaration.value) declaration.value = compact;
      }
      if (!isAuthenticatedRule(declaration)) return;

      const property = declaration.prop.toLowerCase();
      const category = property.includes("shadow") ? "shadow"
        : property.startsWith("border") || property === "outline" ? "border"
        : property === "stroke" ? "border"
        : property === "fill" ? "text"
        : property === "background" || property === "background-color" ? "surface"
        : property === "color" ? "text"
        : null;
      if (!category) return;
      const tokenized = tokenizedColors(declaration.value, category, tokenValues);
      if (tokenized !== declaration.value) declaration.value = tokenized;
    },
    OnceExit(root) {
      // Legacy arbitrary neutral text utilities are used by page-local labels
      // and table cells, not just shared components. Adapt their paint only in
      // the staff workspace (including portals); leave light and login alone.
      const neutralTextRules = [];
      root.walkRules(rule => {
        const match = rule.selector?.replace(/\\/g, "").match(/(?:^|[.:])!?text-\[(#[a-f\d]{3,6})\]/i);
        if (!match || isDarkRule(rule.selector)) return;
        const parsed = parseNeutralColor(match[1]);
        if (!parsed) return;
        const rgb = parsed.channels;
        if (Math.max(...rgb) - Math.min(...rgb) > 30 || Math.min(...rgb) > 245) return;
        const luminance = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
        neutralTextRules.push({
          selector: [
            `:root[data-theme="dark"] .ff-institutional-root ${rule.selector}`,
            `:root[data-theme="dark"] body:has(.ff-institutional-root) :is([role="dialog"],[role="menu"],[role="listbox"],[role="alertdialog"]) ${rule.selector}`,
          ].join(","),
          nodes: [{ prop: "color", value: `var(${luminance < 100 ? "--ff-text-0" : "--ff-text-1"})`, important: true }],
        });
      });
      for (const rule of neutralTextRules) root.append(rule);
      if (!tokenValues.size) return;
      const light = [...tokenValues].map(([name, token]) => `${name}: ${token.light};`).join("\n");
      const dark = [...tokenValues].map(([name, token]) => `${name}: ${token.dark};`).join("\n");
      root.append({
        selector: ":root",
        nodes: light.split("\n").map(line => {
          const separator = line.indexOf(":");
          return { prop: line.slice(0, separator), value: line.slice(separator + 1).replace(/;$/, "").trim() };
        }),
      });
      root.append({
        selector: ':root[data-theme="dark"], .dark',
        nodes: dark.split("\n").map(line => {
          const separator = line.indexOf(":");
          return { prop: line.slice(0, separator), value: line.slice(separator + 1).replace(/;$/, "").trim() };
        }),
      });
    },
  };
}
compactNeumorphicShadows.postcss = true;
module.exports = compactNeumorphicShadows;
module.exports.compactShadow = compactShadow;
