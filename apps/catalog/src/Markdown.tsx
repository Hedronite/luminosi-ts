import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Children, createContext, createElement, isValidElement, useContext, useEffect, useId, useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
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

const link = "text-accent-text underline decoration-accent decoration-2 underline-offset-2";

/** The heading level on the page above this Markdown block (the open-source item title is `h2`). */
const HeadingLevel = createContext(2);

const textOf = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
};

function TaskListItem({ children, ...rest }: { readonly children?: ReactNode } & ComponentPropsWithoutRef<"li">) {
  const id = useId();
  const items = Children.toArray(children);
  const task = items.find((item) => isValidElement(item) && item.type === "input");
  if (task === undefined || !isValidElement<{ checked?: boolean; type?: string }>(task) || task.props.type !== "checkbox") {
    return <li {...rest}>{children}</li>;
  }
  const body = items.filter((item) => item !== task);
  const label = textOf(body).trim();
  return (
    <li {...rest} className="list-none">
      <label htmlFor={id} className="flex items-start gap-2">
        <input
          id={id}
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-accent"
          checked={task.props.checked === true}
          disabled
          readOnly
          aria-label={label.length > 0 ? label : "Task"}
        />
        <span>{body}</span>
      </label>
    </li>
  );
}

/**
 * Someone else's Markdown, rendered as React elements. Raw HTML in it is skipped, never injected, and
 * images are left out: their files aren't served, and remote ones could load from other sites.
 */
const headingClass = (level: number): string =>
  level === 3
    ? "mt-6 text-xl font-semibold first:mt-0"
    : level === 4
      ? "mt-6 text-lg font-semibold"
      : level === 5
        ? "mt-5 font-semibold"
        : "mt-4 font-semibold";

export function Markdown({ markdown, path, repo, pages = [], onPage }: MarkdownProps) {
  const parentLevel = useContext(HeadingLevel);
  const lastLevel = useRef(parentLevel);
  useEffect(() => {
    lastLevel.current = parentLevel;
  }, [markdown, parentLevel]);
  const renderHeading = (sourceLevel: number, children: ReactNode): ReactNode => {
    const ideal = parentLevel + sourceLevel;
    const level = Math.min(6, ideal > lastLevel.current + 1 ? lastLevel.current + 1 : ideal);
    lastLevel.current = level;
    return createElement(`h${String(level)}`, { className: headingClass(level) }, children);
  };

  const components: Components = {
    h1: ({ children }) => renderHeading(1, children),
    h2: ({ children }) => renderHeading(2, children),
    h3: ({ children }) => renderHeading(3, children),
    h4: ({ children }) => renderHeading(4, children),
    h5: ({ children }) => renderHeading(5, children),
    h6: ({ children }) => renderHeading(6, children),
    p: ({ children }) => <p className="mt-3 leading-relaxed">{children}</p>,
    ul: ({ children, className }) => (
      <ul
        className={
          typeof className === "string" && className.includes("contains-task-list")
            ? "mt-3 list-none space-y-1 pl-0"
            : "mt-3 list-disc space-y-1 pl-6"
        }
      >
        {children}
      </ul>
    ),
    ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1 pl-6">{children}</ol>,
    li: (props) => <TaskListItem {...props} />,
    blockquote: ({ children }) => <blockquote className="mt-3 border-l-2 border-line pl-4 text-fg-muted">{children}</blockquote>,
    pre: ({ children }) => {
      const label = textOf(children).trim().slice(0, 48) || "snippet";
      return (
        <pre
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- axe scrollable-region-focusable
          tabIndex={0}
          aria-label={`Code: ${label}`}
          className="mt-3 overflow-x-auto rounded-lg bg-surface-raised p-3 text-sm"
        >
          {children}
        </pre>
      );
    },
    code: ({ children, className }) => <code className={className ?? "rounded bg-surface-raised px-1 py-0.5 text-[0.9em]"}>{children}</code>,
    table: ({ children }) => {
      const label = textOf(children).trim().slice(0, 48) || "table";
      return (
        <div
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- axe scrollable-region-focusable
          tabIndex={0}
          aria-label={`Scrollable table: ${label}`}
          className="mt-3 overflow-x-auto"
        >
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      );
    },
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