"use client";

import { useId, useRef, type ReactNode } from "react";

/**
 * A short label that opens the full text in a centered card over a blurred page. Uses the native <dialog>
 * (showModal), so focus moves into the card, Escape closes it and the page behind is inert. Clicking outside
 * the card also closes it.
 */
export function DetailDialog({ label, title, subject, children }: {
  label: string;
  title: string;
  /** What the label is about (a route or step name), so repeated labels like "Read why" have distinct accessible names. */
  subject?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button type="button" className="rpg-link-button" aria-haspopup="dialog" aria-label={subject ? `${label}: ${subject}` : undefined} onClick={() => ref.current?.showModal()}>
        {label}
      </button>
      <dialog
        ref={ref}
        className="rpg-dialog"
        aria-labelledby={titleId}
        onClick={(event) => {
          if (event.target === ref.current) ref.current?.close();
        }}
      >
        <div className="rpg-dialog__card">
          <h2 id={titleId} className="rpg-dialog__title">{title}</h2>
          <div className="rpg-dialog__body">{children}</div>
          <button type="button" className="rpg-button rpg-button--secondary" onClick={() => ref.current?.close()}>
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
