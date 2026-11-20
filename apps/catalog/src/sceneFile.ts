import type { DescriptorRegistry } from "@hedronite/lts-core";
import { loadDescriptors } from "@hedronite/lts-registry";
import { checkRefs, decodeScene, migrate, SHARE_LIMITS, type Resolve, type Scene, type SceneIssue, type SceneResult } from "@hedronite/lts-scene";

/** What the playground makes of a document it was handed (a file, or a link): the document to open, or what is wrong with it. */
export type Opened = { readonly ok: true; readonly scene: Scene } | { readonly ok: false; readonly title: string; readonly issues: readonly SceneIssue[] };

/** The end of a saved file's name. */
const SAVE_SUFFIX = ".lts-scene.json";

/** The most a scene file may be, in bytes: what a document inflated from a link may be. A larger one is refused unread. */
export const MAX_FILE_BYTES = SHARE_LIMITS.document;

/** The lookup `checkRefs` asks, from the descriptors and the looks the catalog has: an id is known as the kind its descriptor has, and a look by its id. */
export function resolveFrom(registry: DescriptorRegistry, looks: readonly string[]): Resolve {
  return (kind, id) => {
    if (kind === "look") return looks.includes(id) ? {} : undefined;
    const descriptor = registry.get(id);
    return descriptor?.meta.kind === kind ? descriptor : undefined;
  };
}

const refuse = (title: string, issues: readonly SceneIssue[]): Opened => ({ ok: false, title, issues });

/**
 * A document that has been read (`migrate` for a file, `decodeScene` for a link) as the playground takes it: it must still be a
 * document once its references are looked up (`checkRefs`: every id is in the library and every parameter in its range), and it
 * must fit the playground, which holds at most `cap` things. One that does not is refused with the reason and is never cut down to fit.
 */
export function accept(read: SceneResult, resolve: Resolve, cap: number): Opened {
  if (!read.ok) return refuse("This is not a scene document", read.issues);
  const { scene } = read;
  if (scene.nodes.length > cap) {
    return refuse("This scene is too big for the playground", [{ path: ["nodes"], code: "too-many-nodes", message: `the playground holds at most ${String(cap)} things, and this scene has ${String(scene.nodes.length)}` }]);
  }
  const issues = checkRefs(scene, resolve);
  return issues.length === 0 ? { ok: true, scene } : refuse("This scene does not match the library", issues);
}

/** The text of a scene file as the playground takes it. */
export const openText = (text: string, resolve: Resolve, cap: number): Opened => accept(migrate(text), resolve, cap);

/** A file the playground will not read at all, by its size: the refusal, or undefined when it is small enough to read. */
export function refuseFile(size: number): Opened | undefined {
  return size > MAX_FILE_BYTES ? refuse("This file is too big to be a scene", [{ path: [], code: "file-too-large", message: `a scene file is at most ${String(MAX_FILE_BYTES)} bytes, and this one has ${String(size)}` }]) : undefined;
}

/** An issue as a line to read: where it is in the document, then what is wrong. */
export const describeIssue = (issue: SceneIssue): string => (issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`);

/** The name a saved file takes from the name of one that was opened: its stem, without the scene suffix or `.json`. */
export function stemOf(fileName: string): string {
  const stem = fileName.replace(/\.lts-scene\.json$/i, "").replace(/\.json$/i, "").trim();
  return stem === "" ? "scene" : stem;
}

/** The name of the file a scene is saved as. */
export const fileNameFor = (stem: string): string => `${stem}${SAVE_SUFFIX}`;

/** The scene a page's address carries (`?scene=`), or undefined when it carries none. */
export function sceneParam(search: string): string | undefined {
  return new URLSearchParams(search).get("scene") ?? undefined;
}

/** The address that opens the playground on a document: its page, the playground view and the link text. */
export function linkFor(page: Pick<Location, "origin" | "pathname">, link: string): string {
  return `${page.origin}${page.pathname}?view=playground&scene=${link}`;
}

/** What the playground says when the library it checks a document against cannot be loaded: nothing is opened without it. */
const libraryFailed = (): Opened => refuse("The library could not be loaded", [{ path: [], code: "library-unavailable", message: "a scene is checked against the library, and it did not load: reload the page and try again" }]);

/** The lookup for the library as it loads (its descriptors arrive in a chunk of their own), or undefined when they could not be loaded. */
async function library(looks: readonly string[]): Promise<Resolve | undefined> {
  try {
    return resolveFrom(await loadDescriptors(), looks);
  } catch {
    return undefined;
  }
}

/** A scene file, read and checked: refused by size before it is read, then as `openText` takes its text. */
export async function openFile(file: Pick<File, "size" | "text">, looks: readonly string[], cap: number): Promise<Opened> {
  const tooBig = refuseFile(file.size);
  if (tooBig !== undefined) return tooBig;
  let text: string;
  try {
    text = await file.text();
  } catch {
    return refuse("This file could not be read", [{ path: [], code: "unreadable-file", message: "the browser could not read it" }]);
  }
  const resolve = await library(looks);
  return resolve === undefined ? libraryFailed() : openText(text, resolve, cap);
}

/** The document in a link, read and checked as a file's is. A link that does not read is refused with its own issues, before the library is asked for. */
export async function openLink(link: string, looks: readonly string[], cap: number): Promise<Opened> {
  const read = await decodeScene(link);
  if (!read.ok) return accept(read, () => undefined, cap);
  const resolve = await library(looks);
  return resolve === undefined ? libraryFailed() : accept(read, resolve, cap);
}
