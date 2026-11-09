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

function compactNeumorphicShadows() {
  return {
    postcssPlugin: "compact-neumorphic-shadows",
    Declaration(declaration) {
      if (declaration.prop === "box-shadow" || declaration.prop === "--tw-shadow") {
        const compact = compactShadow(declaration.value);
        if (compact !== declaration.value) declaration.value = compact;
      }
    },
  };
}
compactNeumorphicShadows.postcss = true;
module.exports = compactNeumorphicShadows;
module.exports.compactShadow = compactShadow;
