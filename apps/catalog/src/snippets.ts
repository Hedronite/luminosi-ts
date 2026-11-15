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
  if (meta.kind === "icon" && icon !== undefined) {
    const component = pascal(meta.id);
    const constant = camel(meta.id);
    return [
      { label: "React", code: `import { ${component} } from "@hedronite/lts-icons/react";\n\n<${component} title="${meta.name}" />` },
      { label: "TypeScript", code: `import { ${constant}, iconToSvg } from "@hedronite/lts-icons";\n\nconst svg = iconToSvg(${constant}, { title: "${meta.name}" });` },
      { label: "SVG", code: iconToSvg(icon) },
    ];
  }
  if (meta.kind === "primitive") {
    return [
      {
        label: "TypeScript",
        code: `import { createPolyhedronGeometry, primitive } from "@hedronite/lts-primitives";\nimport { Mesh, MeshStandardMaterial } from "three";\n\nconst geometry = createPolyhedronGeometry(primitive("${meta.id}"));\nconst mesh = new Mesh(geometry, new MeshStandardMaterial());\n// Later: geometry.dispose();`,
      },
    ];
  }
  if (meta.kind === "material") {
    return [
      {
        label: "TypeScript",
        code: `import { createMaterial } from "@hedronite/lts-materials";\nimport { hedronite } from "@hedronite/lts-tokens";\n\nconst material = createMaterial("${meta.id}"); // neutral colors\nconst branded = createMaterial("${meta.id}", hedronite.scene);\n// Later: material.dispose();`,
      },
    ];
  }
  return [];
}
