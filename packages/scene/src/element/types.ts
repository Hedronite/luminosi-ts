// What the element's bootstrap and its lazy driver say to each other. Types only, no imports: the bootstrap reads this file and must not reach three, zod or the builder.

/** Where the scene document comes from: a URL to fetch, or the text of an inline `<script type="application/json">`. */
export type DocumentSource = { readonly kind: "url"; readonly url: string } | { readonly kind: "text"; readonly text: string };

/** One thing wrong, as `SceneIssue` of the scene package says it: a path into the document, a short stable code and a sentence. */
export interface ElementIssue {
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly message: string;
}

/** Why a scene did not load, or a look was not applied. The `detail` of the element's `error` event: the validation result, with `ok: false`, as `lumin scene validate` gives it. */
export interface ElementFailure {
  readonly ok: false;
  readonly issues: readonly ElementIssue[];
}

/** What the renderer still held after the scene was freed and before it was disposed: a scene that freed everything leaves only the renderer's own (its environment texture). */
export interface Leftovers {
  readonly geometries: number;
  readonly textures: number;
  readonly targets: number;
}

export interface MountOptions {
  /** The element: it carries the counters (`data-frames`, `data-builds`, `data-geometries`, `data-textures`, `data-targets`, `data-programs`). */
  readonly host: HTMLElement;
  /** Where the canvas goes. The driver adds it hidden and the bootstrap shows it once the first frame is drawn. */
  readonly stage: HTMLElement;
  readonly source: DocumentSource;
  /** A look id that outranks the document's own, or null. */
  readonly look: string | null;
  /** `prefers-reduced-motion: reduce` now. */
  readonly reduced: boolean;
  /** Whether any of the element is in view now. */
  readonly visible: boolean;
  /** Aborted when the element is disconnected or reloaded: a mount that sees it frees what it built and gives up. */
  readonly signal: AbortSignal;
}

/** A scene that is built, drawn once and kept drawn. */
export interface Mounted {
  /** Recolours in place to the look with this id (null: the document's own). A look that is not one is returned as a failure and nothing changes. */
  setLook(id: string | null): ElementFailure | undefined;
  /** True while no part of the element is in view: the loop stops, and starts again when it is false. */
  setVisible(visible: boolean): void;
  /** Reduced motion on: the loop stops after the rest pose is drawn once. Off: it runs again. */
  setReduced(reduced: boolean): void;
  /** Follows the element's size. */
  resize(): void;
  /** Shows the canvas. */
  reveal(): void;
  /** Whether a change of reduced motion needs the scene built again (it has screen effects, which read it when they are made). */
  readonly rebuildOnMotionChange: boolean;
  /** Frees the scene, the renderer and the canvas, and says what the renderer held between the two. */
  dispose(): Leftovers;
}

export type MountResult = { readonly ok: true; readonly mounted: Mounted } | ElementFailure;
