import { describe, expect, it } from "vitest";
import { studyFiles } from "./study.js";

const files = [
  { path: "src/film.ts", text: 'import { MeshBasicNodeMaterial } from "three/webgpu";\nimport { mx_noise_float } from "three/tsl";\nimport { hue } from "./hue";\nexport function film() { return new MeshBasicNodeMaterial(); }' },
  { path: "src/hue.ts", text: "export const hue = 0.5;\nexport type Hue = number;" },
  { path: "src/tube.ts", text: 'export const FRAG = "precision highp float; uniform vec2 uRes; void main(){ gl_FragColor = vec4(gl_FragCoord.xy / uRes, 0., 1.); }";' },
  { path: "src/feather.ts", text: 'export const FRAG = "void main(){ float ign = fract(dot(gl_FragCoord.xy, vec2(0.06, 0.005))); gl_FragColor = vec4(ign); }";' },
  { path: "src/Panel.tsx", text: 'import { useState } from "react";\nimport gsap from "gsap";\nexport function Panel() { return null; }' },
  { path: "src/types.ts", text: "export interface Options { size: number }\nexport type Mode = 'a' | 'b';" },
];

describe("studyFiles", () => {
  const study = studyFiles(files);
  const module = (path: string) => study.modules.find((m) => m.path === path);

  it("reads each module's role, techniques, exports and local closure", () => {
    expect(module("src/film.ts")).toMatchObject({ role: "tsl-material", exports: ["film"], local: ["src/hue.ts"], closure: ["src/film.ts", "src/hue.ts"], selfContained: true });
    expect(module("src/film.ts")?.techniques).toEqual(expect.arrayContaining(["tsl", "noise"]));
    expect(module("src/tube.ts")).toMatchObject({ role: "screen-shader", techniques: ["glsl", "fullscreen"] });
    expect(module("src/types.ts")?.role).toBe("types");
    // gl_FragCoord as a dither seed is a surface shader, not a pass over the frame.
    expect(module("src/feather.ts")).toMatchObject({ role: "glsl-shader", techniques: ["glsl"] });
  });

  it("marks modules that need packages beyond three and React as not self-contained", () => {
    expect(module("src/Panel.tsx")).toMatchObject({ role: "ui", packages: ["gsap", "react"], selfContained: false });
  });

  it("puts self-contained modules the library has a kind for first, smallest closure first", () => {
    expect(study.candidates.map((c) => [c.path, c.kind])).toEqual([
      ["src/feather.ts", "shader"],
      ["src/tube.ts", "effect"],
      ["src/film.ts", "shader"],
    ]);
  });
});
