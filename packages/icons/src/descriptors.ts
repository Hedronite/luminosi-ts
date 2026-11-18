import { defineDescriptor, type AssetDescriptor } from "@hedronite/lts-core";
import { z } from "zod";
import type { IconData } from "./icon.js";
import { allIcons, manifest } from "./manifest.js";
import { iconToSvg, type IconSvgOptions } from "./svg.js";

const parameters = z.object({
  /** Width and height in CSS pixels. */
  size: z.number().int().min(8).max(256).default(24),
  /** Stroke width in grid units. */
  strokeWidth: z.number().min(0.5).max(4).default(2),
  /** Accessible name. Without one the icon is decorative and hidden from assistive technology. */
  title: z.string().min(1).optional(),
});

const byId = new Map<string, IconData>(allIcons.map((icon) => [icon.id, icon]));

/** The parsed parameters as `iconToSvg` takes them: a title that was left out stays out. */
const svgOptions = ({ size, strokeWidth, title }: z.output<typeof parameters>): IconSvgOptions => ({ size, strokeWidth, ...(title === undefined ? {} : { title }) });

/**
 * One descriptor per icon in the manifest. An icon needs no three.js, so `build` makes its SVG string straight away;
 * the icon's data is the only thing the module holds. React users take the same icon from `@hedronite/lts-icons/react`.
 */
export const descriptors: readonly AssetDescriptor<string>[] = manifest.assets.map((asset) => {
  const icon = byId.get(asset.id);
  if (icon === undefined) throw new RangeError(`${asset.id} is in the manifest but has no icon data`);
  return defineDescriptor({
    meta: { ...asset, package: manifest.package },
    parameters,
    hints: { size: { label: "Size (px)", group: "Shape", step: 1 }, strokeWidth: { label: "Stroke", group: "Shape", step: 0.25 }, title: { label: "Accessible name", group: "Text" } },
    templates: [
      { label: "React", code: `import { {{pascal}} } from "@hedronite/lts-icons/react";\n\n<{{pascal}} title="{{name}}" />` },
      { label: "TypeScript", code: `import { {{camel}}, iconToSvg } from "@hedronite/lts-icons";\n\nconst svg = iconToSvg({{camel}}, { title: "{{name}}" });` },
      { label: "SVG", code: "{{svg}}" },
    ],
    vars: (params) => ({ svg: iconToSvg(icon, svgOptions(params)) }),
    build: (params) => Promise.resolve(iconToSvg(icon, svgOptions(params))),
  });
});
