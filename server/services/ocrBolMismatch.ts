// Compare city/state rather than addresses or ZIPs. Missing/ambiguous locations
// are unknown, not mismatches; case, punctuation and full state names are benign.
const states = [
  ["AL", "ALABAMA"], ["AK", "ALASKA"], ["AZ", "ARIZONA"], ["AR", "ARKANSAS"],
  ["CA", "CALIFORNIA"], ["CO", "COLORADO"], ["CT", "CONNECTICUT"], ["DE", "DELAWARE"],
  ["DC", "DISTRICT OF COLUMBIA"], ["FL", "FLORIDA"], ["GA", "GEORGIA"], ["HI", "HAWAII"],
  ["ID", "IDAHO"], ["IL", "ILLINOIS"], ["IN", "INDIANA"], ["IA", "IOWA"], ["KS", "KANSAS"],
  ["KY", "KENTUCKY"], ["LA", "LOUISIANA"], ["ME", "MAINE"], ["MD", "MARYLAND"],
  ["MA", "MASSACHUSETTS"], ["MI", "MICHIGAN"], ["MN", "MINNESOTA"], ["MS", "MISSISSIPPI"],
  ["MO", "MISSOURI"], ["MT", "MONTANA"], ["NE", "NEBRASKA"], ["NV", "NEVADA"],
  ["NH", "NEW HAMPSHIRE"], ["NJ", "NEW JERSEY"], ["NM", "NEW MEXICO"], ["NY", "NEW YORK"],
  ["NC", "NORTH CAROLINA"], ["ND", "NORTH DAKOTA"], ["OH", "OHIO"], ["OK", "OKLAHOMA"],
  ["OR", "OREGON"], ["PA", "PENNSYLVANIA"], ["RI", "RHODE ISLAND"], ["SC", "SOUTH CAROLINA"],
  ["SD", "SOUTH DAKOTA"], ["TN", "TENNESSEE"], ["TX", "TEXAS"], ["UT", "UTAH"],
  ["VT", "VERMONT"], ["VA", "VIRGINIA"], ["WA", "WASHINGTON"], ["WV", "WEST VIRGINIA"],
  ["WI", "WISCONSIN"], ["WY", "WYOMING"],
];
export function normalizeCityState(value: string | undefined): string | null {
  if (!value) return null;
  const text = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/[.,]/g, " ").replace(/\s+/g, " ").trim()
    .replace(/\s+(?:UNITED STATES(?: OF AMERICA)?|USA|US)$/i, "")
    .replace(/[\s-]+\d{5}(?:-\d{4})?$/, "").trim();
  for (const [abbreviation, name] of [...states].sort((a, b) => b[1].length - a[1].length)) {
    for (const suffix of [name, abbreviation]) {
      if (!text.endsWith(` ${suffix}`)) continue;
      const cityText = text.slice(0, -suffix.length).trim();
      // Combined queries can return a whole address. Street numbers are not
      // part of the city, so leave these ambiguous blocks unknown.
      if (/\b\d+\b/.test(cityText)) return null;
      const city = cityText.replace(/[^A-Z0-9]/g, "");
      if (city) return `${city}|${abbreviation}`;
    }
  }
  return null;
}

type Fields = Record<string, string>;
export function bolMismatchReasons(rate: Fields, bol: Fields): string[] {
  const reasons: string[] = [];
  for (const field of ["origin", "destination"]) {
    const expected = normalizeCityState(rate[field]), actual = normalizeCityState(bol[field]);
    if (expected && actual && expected !== actual) {
      reasons.push(`${field}: rate con "${rate[field]}", BOL "${bol[field]}"`);
    }
  }
  const reference = (value: string | undefined) => value?.trim().replace(/^[*#]+|[*]+$/g, "").toUpperCase();
  const expected = reference(rate.load_number), actual = reference(bol.load_number);
  const visibleLabel = /^(?:load|shipment)\s*(?:#|number\b|id\b|no\.?\b|reference\b|ref\.?)/i.test(bol.load_number_label ?? "");
  if (expected && actual && visibleLabel && expected !== actual) {
    reasons.push(`shipment/load reference (${bol.load_number_label || "visible load reference"}): rate con "${rate.load_number}", BOL "${bol.load_number}"`);
  }
  return reasons;
}
