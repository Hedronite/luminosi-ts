import { Check, Copy } from "@hedronite/lts-icons/react";
import { useEffect, useState } from "react";

type Status = "idle" | "copied" | "failed";

const labels: Record<Status, string> = { idle: "Copy", copied: "Copied", failed: "Copy failed" };

/** Copies `text` and says so, visibly and to screen readers. */
export function CopyButton({ text, what }: { readonly text: string; readonly what: string }) {
  const [status, setStatus] = useState<Status>("idle");

  useEffect(() => {
    if (status === "idle") return undefined;
    const timer = setTimeout(() => {
      setStatus("idle");
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [status]);

  const copy = (): void => {
    navigator.clipboard.writeText(text).then(
      () => {
        setStatus("copied");
      },
      () => {
        setStatus("failed");
      },
    );
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`${labels[status]}: ${what}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1 text-sm hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-neutral-700 dark:hover:bg-neutral-800"
    >
      {status === "copied" ? <Check size={16} /> : <Copy size={16} />}
      <span aria-live="polite">{labels[status]}</span>
    </button>
  );
}
