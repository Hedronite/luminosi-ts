import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { resolveLink } from "./vendored";

interface MarkdownProps {
  readonly markdown: string;
  /** The page's path inside its vendored folder, for relative links. */
  readonly path: string;
  readonly repo?: string | undefined;
  /** Other pages of the same item, which relative links open in place. */
  readonly pages?: readonly string[];
  readonly onPage?: (path: string) => void;
}

const link = "text-accent underline underline-offset-2";

/**
 * Someone else's Markdown, rendered as React elements. Raw HTML in it is skipped, never injected, and
 * images are left out: their files aren't served, and remote ones would load from other sites.
 */
export function Markdown({ markdown, path, repo, pages = [], onPage }: MarkdownProps) {
  const components: Components = {
    h1: ({ children }) => <h3 className="mt-6 text-xl font-semibold first:mt-0">{children}</h3>,
    h2: ({ children }) => <h4 className="mt-6 text-lg font-semibold">{children}</h4>,
    h3: ({ children }) => <h5 className="mt-5 font-semibold">{children}</h5>,
    h4: ({ children }) => <h6 className="mt-4 font-semibold">{children}</h6>,
    h5: ({ children }) => <p className="mt-4 font-semibold">{children}</p>,
    h6: ({ children }) => <p className="mt-4 font-semibold">{children}</p>,
    p: ({ children }) => <p className="mt-3 leading-relaxed">{children}</p>,
    ul: ({ children }) => <ul className="mt-3 list-disc space-y-1 pl-6">{children}</ul>,
    ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1 pl-6">{children}</ol>,
    blockquote: ({ children }) => <blockquote className="mt-3 border-l-2 border-line pl-4 text-fg-muted">{children}</blockquote>,
    pre: ({ children }) => <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-raised p-3 text-sm">{children}</pre>,
    code: ({ children, className }) => <code className={className ?? "rounded bg-surface-raised px-1 py-0.5 text-[0.9em]"}>{children}</code>,
    table: ({ children }) => (
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border border-line px-2 py-1 text-left font-semibold">{children}</th>,
    td: ({ children }) => <td className="border border-line px-2 py-1 align-top">{children}</td>,
    hr: () => <hr className="mt-6 border-line" />,
    img: () => null,
    a: ({ href, children }) => {
      const target = resolveLink(href ?? "", path, { ...(repo === undefined ? {} : { repo }), pages });
      if (target.kind === "external") {
        return (
          <a href={target.href} className={link} rel="noreferrer">
            {children}
          </a>
        );
      }
      if (target.kind === "page" && onPage !== undefined) {
        const to = target.path;
        return (
          <button
            type="button"
            onClick={() => {
              onPage(to);
            }}
            className={`${link} cursor-pointer`}
          >
            {children}
          </button>
        );
      }
      return <span>{children}</span>;
    },
  };
  return (
    <div className="max-w-prose break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
