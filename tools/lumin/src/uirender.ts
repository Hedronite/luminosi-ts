// The code passed to page.evaluate runs in the browser; DOM types for this file only.
/// <reference lib="dom" />
/* eslint-disable no-await-in-loop -- one page driven step by step: views, widths and Tab presses run in order, each after the last has settled */
// The rendered half of the lumin-ui audit: what only a laid-out page shows. Visits each view of a
// running catalog in Chromium, at desktop and phone width, and with reduced motion, and reports
// measurements as findings. The lumin-ui skill's Nushell body merges them with the source checks.
import { chromium, type Page } from "@playwright/test";

export interface RenderFinding {
  readonly rule: string;
  readonly area: "a11y" | "type" | "layout" | "motion";
  readonly severity: "high" | "medium" | "low";
  readonly view: string;
  readonly width: number;
  /** A short handle on the element: tag, id or first classes, and its accessible text. */
  readonly target: string;
  readonly detail: string;
}

export const catalogViews = ["assets", "icons", "looks", "effects", "open-source", "playground", "growth"] as const;

const DESKTOP = 1280;
const PHONE = 320;

/** Measurements taken inside the page; plain data back out. */
async function measure(page: Page): Promise<{
  readonly overflow: number;
  readonly targets: readonly { target: string; w: number; h: number }[];
  readonly unnamed: readonly string[];
  readonly tiny: readonly { target: string; px: number }[];
  readonly long: readonly { target: string; chars: number }[];
}> {
  return page.evaluate(() => {
    const textOf = (el: Element): string => (el instanceof HTMLElement ? el.innerText : el.textContent);
    const handle = (el: Element): string => {
      const id = el.id === "" ? "" : `#${el.id}`;
      const cls = typeof el.className === "string" && el.className !== "" ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
      const name = (el.getAttribute("aria-label") ?? textOf(el)).trim().replace(/\s+/g, " ").slice(0, 40);
      return `${el.tagName.toLowerCase()}${id}${cls}${name === "" ? "" : ` "${name}"`}`;
    };
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const controls = [...document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="checkbox"], [tabindex]:not([tabindex="-1"])')].filter(visible);
    const targets = controls.flatMap((el) => {
      const r = el.getBoundingClientRect();
      // Inline links in running text are exempt from the target size minimum.
      const inline = el.tagName === "A" && getComputedStyle(el).display === "inline" && el.parentElement !== null && /^(P|LI|SPAN|TD|DD)$/.test(el.parentElement.tagName);
      // A control inside its label is hit through the whole label.
      const label = el.closest("label")?.getBoundingClientRect();
      const viaLabel = label !== undefined && label.width >= 24 && label.height >= 24;
      return !inline && !viaLabel && (r.width < 24 || r.height < 24) ? [{ target: handle(el), w: Math.round(r.width), h: Math.round(r.height) }] : [];
    });
    const unnamed = controls
      .filter((el) => {
        const label = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "";
        const by = el.getAttribute("aria-labelledby");
        const labelled = el.id !== "" && document.querySelector(`label[for="${CSS.escape(el.id)}"]`) !== null;
        const wrapped = el.closest("label") !== null;
        const text = textOf(el).trim();
        const alt = [...el.querySelectorAll("img[alt]")].some((img) => (img.getAttribute("alt") ?? "") !== "");
        return label.trim() === "" && by === null && !labelled && !wrapped && text === "" && !alt && !(el instanceof HTMLInputElement && ["submit", "button"].includes(el.type) && el.value !== "");
      })
      .map(handle);
    // Text in graphics (SVG swatches) and in hidden decoration is not reading text.
    const graphic = (el: Element): boolean => el.closest('svg, [aria-hidden="true"]') !== null;
    const texts = [...document.querySelectorAll("body *")].filter((el) => visible(el) && !graphic(el) && [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== ""));
    const tiny = texts.flatMap((el) => {
      const px = Number.parseFloat(getComputedStyle(el).fontSize);
      return px < 12 ? [{ target: handle(el), px }] : [];
    });
    // Running text only: a list item that holds blocks (a grid of cards) is layout, not a line.
    const holdsBlocks = (el: Element): boolean => [...el.children].some((child) => /^(block|flex|grid|table)/.test(getComputedStyle(child).display));
    const long = [...document.querySelectorAll("p, li, dd")].filter((el) => visible(el) && !holdsBlocks(el)).flatMap((el) => {
      const s = getComputedStyle(el);
      const chars = Math.round(el.getBoundingClientRect().width / (Number.parseFloat(s.fontSize) * 0.5));
      return chars > 90 && textOf(el).length > 120 ? [{ target: handle(el), chars }] : [];
    });
    return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, targets, unnamed, tiny, long };
  });
}

/** Tab through the page and report focused controls that draw no outline or ring. */
async function focusRings(page: Page, presses: number): Promise<readonly string[]> {
  const bare: string[] = [];
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("Tab");
    const found = await page.evaluate(() => {
      const el = document.activeElement;
      if (el === null || el === document.body) return null;
      const s = getComputedStyle(el);
      const drawn = (s.outlineStyle !== "none" && Number.parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
      const name = (el.getAttribute("aria-label") ?? (el instanceof HTMLElement ? el.innerText : "")).trim().slice(0, 40);
      return drawn ? "" : `${el.tagName.toLowerCase()}${name === "" ? "" : ` "${name}"`}`;
    });
    if (found !== null && found !== "" && !bare.includes(found)) bare.push(found);
  }
  return bare;
}

/** Under reduced motion: canvases whose frame counter still climbs, and CSS animations still running. */
async function motionUnderReduce(page: Page): Promise<readonly string[]> {
  const sample = () =>
    page.evaluate(() => ({
      frames: [...document.querySelectorAll("[data-frames]")].map((el) => [el.getAttribute("data-testid") ?? el.tagName.toLowerCase(), Number(el.getAttribute("data-frames") ?? 0)] as const),
      animations: document.getAnimations().filter((a) => a.playState === "running").length,
    }));
  await page.waitForTimeout(1500);
  const before = await sample();
  await page.waitForTimeout(1200);
  const after = await sample();
  const moving = after.frames.filter(([, n], i) => n > (before.frames[i]?.[1] ?? n) + 2).map(([id]) => `canvas ${id}`);
  return after.animations > 0 ? [...moving, `${String(after.animations)} CSS animation(s) running`] : moving;
}

export async function renderAudit(url: string, views: readonly string[]): Promise<readonly RenderFinding[]> {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const findings: RenderFinding[] = [];
  try {
    for (const view of views) {
      const at = new URL(url);
      if (view !== "assets") at.searchParams.set("view", view);
      for (const width of [DESKTOP, PHONE]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.goto(at.toString(), { waitUntil: "networkidle" });
        const m = await measure(page);
        const add = (rule: string, area: RenderFinding["area"], severity: RenderFinding["severity"], target: string, detail: string) => findings.push({ rule, area, severity, view, width, target, detail });
        if (m.overflow > 1) add("layout.reflow", "layout", width === PHONE ? "high" : "medium", "document", `scrolls sideways by ${String(m.overflow)}px at ${String(width)}px wide`);
        for (const t of m.targets) add("a11y.target-size", "a11y", "medium", t.target, `${String(t.w)}x${String(t.h)}px, under the 24px minimum`);
        for (const u of m.unnamed) add("a11y.unnamed-control", "a11y", "high", u, "no accessible name");
        if (width === DESKTOP) {
          for (const t of m.tiny) add("type.tiny-text", "type", "medium", t.target, `${String(t.px)}px text`);
          for (const l of m.long) add("type.measure", "type", "low", l.target, `about ${String(l.chars)} characters a line`);
          for (const f of await focusRings(page, 25)) add("a11y.focus-hidden", "a11y", "high", f, "takes focus with no visible outline or ring");
        }
        await page.close();
      }
      const reduced = await browser.newPage({ viewport: { width: DESKTOP, height: 900 }, reducedMotion: "reduce" });
      await reduced.goto(at.toString(), { waitUntil: "networkidle" });
      for (const m of await motionUnderReduce(reduced)) findings.push({ rule: "motion.ignores-reduce", area: "motion", severity: "high", view, width: DESKTOP, target: m, detail: "keeps moving with prefers-reduced-motion: reduce" });
      await reduced.close();
    }
  } finally {
    await browser.close();
  }
  return findings;
}
/* eslint-enable no-await-in-loop -- end of the step-by-step audit */
