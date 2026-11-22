import type { PolicyClass } from "@hedronite/lts-core";

/** What the Open source view shows: other people's open-source material vendored under assets/vendor. */

export type VendorKind = "icons" | "components" | "demos" | "engines" | "skills";

/** The words the Open source view uses for each class of the license gate (`tools/vendor/src/policy.ts`). */
export const policyTitles: Readonly<Record<PolicyClass, string>> = {
  adopt: "adoptable",
  "adopt-with-attribution": "adoptable with attribution",
  "showcase-only": "showcase only",
  forbidden: "not adoptable",
};

/** A source on the page: the repository, and the commit its folder was taken at. */
export interface VendorSource {
  readonly repo: string;
  readonly commit: string;
}

/** The repository at that exact commit, not at a branch: `https://github.com/owner/repo/tree/<40-hex>`. */
export const commitUrl = (source: VendorSource): string => `${source.repo}/tree/${source.commit}`;

/** A commit as the credit lines show it. */
export const shortCommit = (commit: string): string => commit.slice(0, 8);

/** One policy class and license, with every row that names it added up. */
export interface PolicySummary {
  readonly class: PolicyClass;
  readonly spdx: string;
  readonly fileCount: number;
}

/**
 * A folder's policy rows, merged by class and license: a folder may name one class and license twice (a
 * second set of paths), and the page shows it once with the two counts added.
 */
export function mergePolicies(policies: readonly { readonly class: PolicyClass; readonly spdx: string; readonly fileCount: number }[]): readonly PolicySummary[] {
  const merged = new Map<string, PolicySummary>();
  for (const policy of policies) {
    const key = `${policy.class}:${policy.spdx}`;
    const seen = merged.get(key);
    merged.set(key, { class: policy.class, spdx: policy.spdx, fileCount: (seen?.fileCount ?? 0) + policy.fileCount });
  }
  return [...merged.values()];
}

/** A Markdown file from a vendored folder; `path` is relative to that folder. Its text loads separately (vendor-pages). */
export interface VendorPage {
  readonly path: string;
  readonly title: string;
}

/** A skill or a demo inside a folder. */
export interface VendorItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** A live demo, for demos. */
  readonly link?: string;
  readonly pages: readonly VendorPage[];
}

export interface VendorEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: VendorKind;
  readonly what: string;
  readonly source: string;
  readonly sourceUrl: string;
  /** The GitHub repository, when the source is one: relative links in pages resolve against it. */
  readonly repo?: string;
  readonly license: string;
  readonly credit: string;
  readonly pulled: string;
  readonly link?: string;
  /** Icon packs made from this set: this pack id, or ids that start with it and a dash. */
  readonly packPrefix?: string;
  /** A preview image among the catalog's public files. */
  readonly preview?: string;
  readonly files: number;
  readonly bytes: number;
  readonly readme?: VendorPage;
  readonly items: readonly VendorItem[];
}

export const kindTitles: Readonly<Record<VendorKind, string>> = {
  icons: "Icon sets",
  components: "Components",
  demos: "Demos",
  engines: "Engines",
  skills: "Agent skills",
};

/** Whether a pack id comes from a set with this prefix: "stash" covers "stash-regular", not "stashed". */
export const packFromSet = (packId: string, prefix: string): boolean => packId === prefix || packId.startsWith(`${prefix}-`);

/**
 * Where a link inside a vendored page goes. Absolute links and anchors stay. A relative link to another
 * page of the same item opens it in the catalog; any other relative link goes to the file on GitHub
 * when the folder has a repository, and nowhere otherwise.
 */
export function resolveLink(
  href: string,
  from: string,
  options: { readonly repo?: string; readonly pages?: readonly string[] },
): { readonly kind: "external"; readonly href: string } | { readonly kind: "page"; readonly path: string } | { readonly kind: "none" } {
  if (/^(https?:|mailto:)/i.test(href)) return { kind: "external", href };
  if (href.startsWith("#") || href === "") return { kind: "none" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: "none" };
  const [target = ""] = href.split("#");
  const parts = [...from.split("/").slice(0, -1), ...target.split("/")];
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== "." && part !== "") resolved.push(part);
  }
  const path = resolved.join("/");
  if (options.pages?.includes(path) === true) return { kind: "page", path };
  if (options.repo !== undefined) return { kind: "external", href: `${options.repo}/blob/HEAD/${path}` };
  return { kind: "none" };
}

/** "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit] ?? "GB"}`;
}
