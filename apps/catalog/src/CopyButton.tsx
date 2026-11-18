import { Check, Copy } from "@hedronite/lts-icons/react";
import { useEffect, useRef, useState } from "react";

type Status = "idle" | "copied" | "manual";

const labels: Record<Status, string> = { idle: "Copy", copied: "Copied", manual: "Press ⌘C / Ctrl+C to copy" };

/** What copying needs from the browser; the tests pass fakes. */
export interface CopyHost {
  /** `navigator.clipboard`: missing on a page served over plain http:// (anything but localhost). */
  readonly clipboard: { readonly writeText: (text: string) => Promise<void> } | undefined;
  /** The older route: select a hidden textarea and run `execCommand("copy")`. False when the browser refuses. */
  readonly execCopy: (text: string) => boolean;
}

/**
 * Puts `text` on the clipboard by the best route there is: the async clipboard API, then the older
 * `execCommand` route, then "manual" when both fail (the caller shows the text selected for a copy
 * by hand). It never throws: every refusal ends in "manual".
 */
export async function copyText(text: string, host: CopyHost): Promise<"copied" | "manual"> {
  if (host.clipboard !== undefined) {
    try {
      await host.clipboard.writeText(text);
      return "copied";
    } catch {
      // Denied, or the page is not focused: the older route may still work.
    }
  }
  try {
    return host.execCopy(text) ? "copied" : "manual";
  } catch {
    return "manual";
  }
}

/**
 * Selects `text` in an off-screen textarea and asks the browser to copy the selection. The textarea goes
 * next to the focused control, not on the body: a modal dialog makes the rest of the page inert, and an
 * inert element cannot take focus or a selection.
 */
function execCopy(text: string): boolean {
  const before = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  area.readOnly = true;
  // Invisible but rendered: a hidden element cannot be selected.
  area.style.cssText = "position:fixed;opacity:0";
  (before?.parentElement ?? document.body).append(area);
  try {
    area.focus();
    area.select();
    // Some browsers report success for an empty selection: only a focused, selected textarea counts.
    if (document.activeElement !== area) return false;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only copy route a page on plain http:// has, where navigator.clipboard is undefined
    return document.execCommand("copy");
  } finally {
    area.remove();
    if (before instanceof HTMLElement) before.focus();
  }
}

/**
 * Copies `text` and says so, visibly and to screen readers. Where the browser lets a page copy nothing,
 * it selects the text in a box beside the button and asks for Ctrl+C or ⌘C.
 */
export function CopyButton({ text, what }: { readonly text: string; readonly what: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // A manual copy waits for the viewer: it ends when they leave the box.
    if (status !== "copied") return undefined;
    const timer = setTimeout(() => {
      setStatus("idle");
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [status]);

  const copy = (): void => {
    // navigator.clipboard is typed as always there; it is undefined on an insecure origin, which copyText handles.
    void copyText(text, { clipboard: navigator.clipboard, execCopy }).then(setStatus);
  };

  return (
    <span className="relative inline-flex">
      <button
        ref={trigger}
        type="button"
        onClick={copy}
        aria-label={`${labels[status]}: ${what}`}
        className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-sm hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {status === "copied" ? <Check size={16} /> : <Copy size={16} />}
        <span aria-live="polite">{labels[status]}</span>
      </button>
      {status === "manual" ? (
        <textarea
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the viewer just asked to copy: the box takes focus with the text selected, ready for Ctrl+C
          autoFocus
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          readOnly
          value={text}
          rows={4}
          aria-label={`${what}, selected`}
          onBlur={() => {
            setStatus("idle");
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            // Ends the manual copy, not the dialog the button sits in.
            event.preventDefault();
            event.stopPropagation();
            setStatus("idle");
            trigger.current?.focus();
          }}
          className="absolute right-0 top-full z-10 mt-1 w-72 rounded-lg border border-line bg-surface p-2 font-mono text-xs"
        />
      ) : null}
    </span>
  );
}
