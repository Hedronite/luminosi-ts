import { loadDescriptors } from "@hedronite/lts-registry";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { shownFields, startValues } from "./paramFit";
import ParameterPanel from "./ParameterPanel";

const registry = await loadDescriptors();
const markup = (id: string, overrides: Record<string, unknown> = {}): string => {
  const described = registry.get(id);
  if (described === undefined) throw new Error(`no descriptor for ${id}`);
  return renderToStaticMarkup(<ParameterPanel described={described} assetId={id} noun="shader" overrides={overrides} start={startValues(described)} />);
};

describe("ParameterPanel", () => {
  it("makes a labelled control of the schema's type for every parameter, for every asset that has parameters", () => {
    for (const descriptor of registry.list().filter((each) => shownFields(each).length > 0)) {
      const html = markup(descriptor.meta.id);
      for (const field of shownFields(descriptor)) {
        expect(html, `${descriptor.meta.id} ${field.key}`).toContain(`data-parameter="${field.key}"`);
        expect(html, `${descriptor.meta.id} ${field.key} label`).toContain(`for="parameter-${field.key}"`);
        expect(html, `${descriptor.meta.id} ${field.key} control`).toContain(`id="parameter-${field.key}"`);
      }
    }
  });

  it("a number is a slider and a number input with the schema's bounds, a color a color input, a choice a select, a switch for a boolean", () => {
    const hologram = markup("hologram");
    expect(hologram).toMatch(/<input type="range"[^>]*min="5"[^>]*max="400"/);
    expect(hologram).toMatch(/<input id="parameter-density" type="number"[^>]*min="5"[^>]*max="400"/);
    expect(hologram).toContain('type="color"');
    expect(markup("framed-solid")).toContain("<select");
    for (const { meta } of registry.list().filter(({ fields }) => fields.some((field) => field.type === "boolean"))) expect(markup(meta.id)).toContain('role="switch"');
  });

  it("offers no control for a model URL", () => {
    expect(markup("crystal-cluster-glb")).not.toContain("parameter-url");
  });

  it("groups the controls by the hints' groups, with a legend each", () => {
    expect(markup("cube")).toContain("<legend");
    expect(markup("cube")).toContain("Shape");
  });

  it("offers a reset that is off until something changes, a status for notices, and says which parameter rebuilds", () => {
    expect(markup("toon")).toMatch(/<button[^>]*disabled=""[^>]*>Reset to defaults/);
    expect(markup("toon", { outline: 0.1 })).not.toMatch(/<button[^>]*disabled=""[^>]*>Reset to defaults/);
    expect(markup("toon")).toContain('role="status"');
    const toon = markup("toon");
    expect(toon).toContain("Rebuilds the asset");
    expect(markup("hologram")).not.toContain("Rebuilds the asset");
  });

  it("offers a way to clear a parameter that has no default once it is set", () => {
    expect(markup("dissolve")).not.toContain(">Clear<");
    expect(markup("dissolve", { progress: 0.5 })).toContain(">Clear<");
  });
});
