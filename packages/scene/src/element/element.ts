// The element's bootstrap: the class, its observers and the poster. It is what a page loads. It reaches no three, no zod and no scene builder: the one
// dynamic import of `./draw.js` brings those in, when the element is about to be seen. A boundary test walks this file's static imports to keep it so.
import type { DocumentSource, ElementFailure, Leftovers, Mounted } from "./types.js";

/** The tag `defineSceneElement` registers, unless it is given another. */
export const SCENE_ELEMENT_TAG = "lts-scene";

/** How far from the viewport an element may be and still start to load: its scene is built by the time it scrolls in. */
const NEAR_MARGIN = "200px 0px";

// The element's own styles. They go into the shadow root as a constructable stylesheet, which a page's `style-src 'self'` does not block; a <style> element would be
// (the site's policy is exactly that), and the element would lose its layout: the canvas would sit against the page, not the element.
const STYLE = `
:host { display: block; position: relative; overflow: hidden; contain: layout paint; }
img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
#stage { position: absolute; inset: 0; }
`;

/** Puts the element's styles into `root` as a constructable stylesheet; false where the browser has none. */
function adopt(root: ShadowRoot): boolean {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
    return true;
  } catch {
    return false;
  }
}

/** Where the element is: `poster` shows the picture, `loading` builds the scene, `ready` draws it, `error` kept the picture after a failure. Also the `data-state` attribute. */
export type SceneElementState = "poster" | "loading" | "ready" | "error";

const reducedQuery = "(prefers-reduced-motion: reduce)";

/**
 * `<lts-scene>`: a scene document drawn on three's WebGPURenderer (WebGL 2 where there is no WebGPU), with no React.
 *
 * - `src`: the URL of a scene document; or one child `<script type="application/json">` holds it inline (`src` wins when both are there).
 * - `poster`: an image shown at once, until the first frame of the scene is drawn.
 * - `alt`: the accessible name; the element has `role="img"`.
 * - `look`: a look id that outranks the document's own. A change recolours in place.
 * - `loading`: `lazy` (the default) builds the scene when the element is near the viewport, `eager` at once.
 *
 * `data-state` goes `poster`, `loading`, `ready`, or `error` (the poster stays, and an `error` event carries the validation result as its `detail`).
 */
export class SceneElement extends HTMLElement {
  static readonly observedAttributes = ["src", "poster", "alt", "look", "loading"];

  #image: HTMLImageElement | undefined;
  #stage: HTMLElement | undefined;
  #near: IntersectionObserver | undefined;
  #view: IntersectionObserver | undefined;
  #size: ResizeObserver | undefined;
  #motion: MediaQueryList | undefined;
  #controller: AbortController | undefined;
  #mounted: Mounted | undefined;
  /** Whether the element is within the margin of the viewport. */
  #isNear = false;
  /** Whether any of it is in the viewport. A browser with no observer says it is, so it draws. */
  #inView = true;
  #state: SceneElementState = "poster";

  get state(): SceneElementState {
    return this.#state;
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "img");
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    if (this.#image === undefined) {
      this.#image = document.createElement("img");
      this.#image.setAttribute("part", "poster");
      this.#image.alt = "";
      this.#image.decoding = "async";
      this.#stage = document.createElement("div");
      this.#stage.id = "stage";
      this.#stage.setAttribute("part", "stage");
      root.append(this.#image, this.#stage);
      if (!adopt(root)) {
        // No constructable stylesheets here (an older browser): a <style> element, which is what a page with no `style-src` allows.
        const style = document.createElement("style");
        style.textContent = STYLE;
        root.prepend(style);
      }
    }
    this.#syncPoster();
    this.#syncName();
    this.#setState("poster");
    this.#controller = undefined;
    this.#isNear = false;
    if (typeof IntersectionObserver === "undefined") {
      this.#isNear = true;
    } else {
      this.#near = new IntersectionObserver(
        (entries) => {
          this.#isNear = entries.some((entry) => entry.isIntersecting);
          if (this.#isNear) this.#maybeLoad();
        },
        { rootMargin: NEAR_MARGIN },
      );
      this.#near.observe(this);
      // Any of it in view: a threshold of 0 reports the moment the last pixel leaves, and the first that returns.
      this.#view = new IntersectionObserver((entries) => {
        this.#inView = entries.some((entry) => entry.isIntersecting);
        this.#mounted?.setVisible(this.#inView);
      });
      this.#view.observe(this);
    }
    if (typeof ResizeObserver !== "undefined") {
      this.#size = new ResizeObserver(() => {
        this.#mounted?.resize();
      });
      this.#size.observe(this);
    }
    this.#motion = matchMedia(reducedQuery);
    this.#motion.addEventListener("change", this.#onMotion);
    this.#maybeLoad();
  }

  disconnectedCallback(): void {
    this.#near?.disconnect();
    this.#view?.disconnect();
    this.#size?.disconnect();
    this.#near = this.#view = this.#size = undefined;
    this.#motion?.removeEventListener("change", this.#onMotion);
    this.#motion = undefined;
    this.#teardown();
  }

  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    if (previous === next || !this.isConnected) return;
    if (name === "poster") this.#syncPoster();
    else if (name === "alt") this.#syncName();
    else if (name === "look") this.#applyLook();
    else if (name === "loading") this.#maybeLoad();
    else if (name === "src") {
      this.#teardown();
      this.#maybeLoad();
    }
  }

  readonly #onMotion = (): void => {
    const mounted = this.#mounted;
    if (mounted === undefined) return;
    if (mounted.rebuildOnMotionChange) {
      this.#teardown();
      this.#maybeLoad();
    } else mounted.setReduced(this.#motion?.matches ?? false);
  };

  #setState(state: SceneElementState): void {
    this.#state = state;
    this.setAttribute("data-state", state);
  }

  #syncPoster(): void {
    const poster = this.getAttribute("poster");
    if (poster === null) this.#image?.removeAttribute("src");
    else this.#image?.setAttribute("src", poster);
  }

  #syncName(): void {
    const alt = this.getAttribute("alt");
    if (alt === null) this.removeAttribute("aria-label");
    else this.setAttribute("aria-label", alt);
  }

  #applyLook(): void {
    const failure = this.#mounted?.setLook(this.getAttribute("look"));
    if (failure !== undefined) this.#fail(failure, false);
  }

  #source(): DocumentSource | undefined {
    const src = this.getAttribute("src");
    if (src !== null && src !== "") return { kind: "url", url: new URL(src, this.baseURI).href };
    const inline = [...this.children].find((child) => child.localName === "script" && child.getAttribute("type") === "application/json");
    return inline === undefined ? undefined : { kind: "text", text: inline.textContent };
  }

  /** Builds the scene when the element is near the viewport (or `loading="eager"`), once. */
  #maybeLoad(): void {
    if (this.#controller !== undefined || !this.isConnected) return;
    if (this.#isNear || this.getAttribute("loading") === "eager") void this.#load();
  }

  async #load(): Promise<void> {
    const controller = new AbortController();
    this.#controller = controller;
    this.#setState("loading");
    const source = this.#source();
    if (source === undefined) {
      this.#fail({ ok: false, issues: [{ path: ["src"], code: "no-source", message: "give the element a src, or one child script of type application/json" }] }, true);
      return;
    }
    const stage = this.#stage;
    if (stage === undefined) return;
    let result;
    try {
      // The one dynamic import: three, the scene builder and zod come with it.
      const draw = await import("./draw.js");
      if (controller.signal.aborted) return;
      result = await draw.mount({ host: this, stage, source, look: this.getAttribute("look"), reduced: this.#motion?.matches ?? false, visible: this.#inView, signal: controller.signal });
    } catch (error) {
      result = { ok: false as const, issues: [{ path: [], code: "load-failed", message: `the scene code could not be loaded: ${error instanceof Error ? error.message : String(error)}` }] };
    }
    if (controller.signal.aborted) {
      if (result.ok) result.mounted.dispose();
      return;
    }
    if (!result.ok) {
      this.#fail(result, true);
      return;
    }
    this.#mounted = result.mounted;
    result.mounted.reveal();
    if (this.#image !== undefined) this.#image.style.visibility = "hidden";
    this.#setState("ready");
  }

  /** The poster stays. A failure to load puts the element in `error`; a look that is not one only says so. */
  #fail(failure: ElementFailure, loading: boolean): void {
    if (loading) this.#setState("error");
    this.dispatchEvent(new CustomEvent<ElementFailure>("error", { detail: failure }));
  }

  /** Frees everything the element built and shows the poster again. A new connection builds again. */
  #teardown(): void {
    this.#controller?.abort();
    this.#controller = undefined;
    const left: Leftovers | undefined = this.#mounted?.dispose();
    this.#mounted = undefined;
    if (left !== undefined) this.setAttribute("data-leftovers", JSON.stringify(left));
    if (this.#image !== undefined) this.#image.style.visibility = "visible";
    this.#setState("poster");
  }
}

/** Registers the element (as `lts-scene`, or the tag given) if it is not registered yet, and returns the class. Nothing registers itself on import. */
export function defineSceneElement(tag: string = SCENE_ELEMENT_TAG): typeof SceneElement {
  if (customElements.get(tag) === undefined) customElements.define(tag, SceneElement);
  return SceneElement;
}
