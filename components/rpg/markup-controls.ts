/**
 * Lists the interactive controls in a server-rendered HTML string, one line per control, sorted:
 * buttons (by aria-label or text), links (href and text), inputs (type and name), selects and
 * textareas (name), and details summaries (text). Used to check that two presentations of the same
 * data offer the same controls. Pure; no DOM needed.
 */
export function markupControls(html: string): string[] {
  const controls: string[] = [];
  for (const [, attrs, inner] of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    controls.push(`button: ${attr(attrs, "aria-label") ?? text(inner)}`);
  }
  for (const [, attrs, inner] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    controls.push(`link: ${attr(attrs, "href") ?? ""} | ${attr(attrs, "aria-label") ?? text(inner)}`);
  }
  for (const [, attrs] of html.matchAll(/<input\b([^>]*?)\/?>/g)) {
    controls.push(`input: ${attr(attrs, "type") ?? "text"} | ${attr(attrs, "name") ?? ""}`);
  }
  for (const [, tag, attrs] of html.matchAll(/<(select|textarea)\b([^>]*)>/g)) {
    controls.push(`${tag}: ${attr(attrs, "name") ?? ""}`);
  }
  for (const [, inner] of html.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g)) {
    controls.push(`summary: ${text(inner)}`);
  }
  return controls.sort();
}

function attr(attrs: string, name: string): string | undefined {
  const match = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? decode(match[1]) : undefined;
}

function text(html: string): string {
  return decode(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function decode(value: string): string {
  return value
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'").replaceAll("&#39;", "'").replaceAll("&amp;", "&");
}
