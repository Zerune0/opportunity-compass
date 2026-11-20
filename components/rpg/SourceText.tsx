import { parseSourceText, splitSourceNote } from "@/lib/source-text";

/**
 * Shows a source_text the same way everywhere: the organizer's words (quoted) and our note as the main text, and
 * the bookkeeping (official link, who verified it and when, the note that hours and cost are estimates) behind a
 * small "Source & verification" disclosure. Nothing is reworded; text the parser cannot place stays in the main text.
 */
export function SourceText({ text, quotePlain = false }: { text: string | null | undefined; quotePlain?: boolean }) {
  const parsed = parseSourceText(text);
  const parts = splitSourceNote(parsed.notes);
  const excerpt = parsed.marked_official ? parsed.excerpt : null;
  const hasMeta = Boolean(parts.url || parts.verified || parts.estimate_note || parts.human_verified);
  if (!excerpt && !parts.body && !hasMeta) return null;
  return (
    <div className="rpg-source">
      {excerpt && (
        <blockquote className="rpg-source__quote">
          <span className="rpg-source__who">The organizer says</span>“{excerpt}”
        </blockquote>
      )}
      {parts.body && (quotePlain && !excerpt
        ? <blockquote className="rpg-source__quote">{parts.body}</blockquote>
        : <p className="rpg-source__note">{excerpt ? <><span className="rpg-source__who">Our note</span>{parts.body}</> : parts.body}</p>)}
      {hasMeta && (
        <details className="rpg-source__meta">
          <summary>Source &amp; verification</summary>
          <ul>
            {parts.url && (
              <li>
                Official page:{" "}
                <a href={parts.url} target="_blank" rel="noopener noreferrer">{parts.url.replace(/^https?:\/\/(www\.)?/, "")}</a>
              </li>
            )}
            {(parts.verified || parts.human_verified) && (
              <li>{parts.verified ?? "Checked by a person against the application instructions."}</li>
            )}
            {parts.estimate_note && <li>{parts.estimate_note}</li>}
          </ul>
        </details>
      )}
    </div>
  );
}
