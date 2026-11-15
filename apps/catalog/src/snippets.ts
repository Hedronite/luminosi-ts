import type { AssetMeta } from "@hedronite/lts-core";
import { iconToSvg, type IconData } from "@hedronite/lts-icons";

export interface Snippet {
  readonly label: string;
  readonly code: string;
}

const camel = (id: string): string => id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const pascal = (id: string): string => camel(id).replace(/^[a-z]/, (c) => c.toUpperCase());

/** Copy-ready usage for an asset. Kinds without a package yet have none. */
export function snippetsFor(meta: AssetMeta, icon: IconData | undefined): readonly Snippet[] {
  if (meta.kind !== "icon" || icon === undefined) {
    return [];
  }
  const component = pascal(meta.id);
  const constant = camel(meta.id);
  return [
    {
      label: "React",
      code: `import { ${component} } from "@hedronite/lts-icons/react";\n\n<${component} title="${meta.name}" />`,
    },
    {
      label: "TypeScript",
      code: `import { ${constant}, iconToSvg } from "@hedronite/lts-icons";\n\nconst svg = iconToSvg(${constant}, { title: "${meta.name}" });`,
    },
    { label: "SVG", code: iconToSvg(icon) },
  ];
}
