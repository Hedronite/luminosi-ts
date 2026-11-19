// Package boundaries from the manifesto (README.md, "Package Boundaries").
// A package import resolves into the other package's dist/ once built, or stays an
// unresolved "@hedronite/lts-*" name before that; every rule matches both forms.
const pkg = (names) => `^(packages/(${names})/|@hedronite/lts-(${names})$)`;
const anyPackage = "^(packages/|@hedronite/lts-)";
const react = "(^|/)(react|react-dom|@react-three/[^/]+)(/|$)";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "No circular dependencies.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "core-is-the-foundation",
      comment: "core and tokens depend on no other package.",
      severity: "error",
      from: { path: "^packages/(core|tokens)/" },
      to: { path: anyPackage, pathNot: "^(packages/$1/|@hedronite/lts-$1$)" },
    },
    {
      name: "only-core-is-shared",
      comment: "Libraries import core and tokens, not each other.",
      severity: "error",
      from: { path: "^packages/(icons|primitives|materials|shaders|postfx)/" },
      to: { path: anyPackage, pathNot: [pkg("core|tokens"), "^(packages/$1/|@hedronite/lts-$1$)"] },
    },
    {
      name: "objects-compose-only",
      comment: "objects may build on primitives and materials, nothing else.",
      severity: "error",
      from: { path: "^packages/objects/" },
      to: { path: anyPackage, pathNot: pkg("core|tokens|primitives|materials|objects") },
    },
    {
      name: "scenes-compose-only",
      comment: "scenes may compose primitives, materials and shaders, nothing else.",
      severity: "error",
      from: { path: "^packages/scenes/" },
      to: { path: anyPackage, pathNot: pkg("core|tokens|primitives|materials|shaders|scenes") },
    },
    {
      name: "pure-typescript-core",
      comment: "No React or React Three Fiber outside icons/react, adapters and the apps.",
      severity: "error",
      from: { path: ["^packages/(core|tokens|primitives|objects|scenes|materials|shaders|postfx|registry)/", "^packages/icons/src/(?!react/)"] },
      to: { path: react },
    },
    {
      name: "scene-root-is-pure-data",
      comment:
        "The scene package's root and ./emit read, check, migrate and write documents: zod and core only, so no three.js, no three/webgpu and no React. " +
        "Only src/three.ts (the ./three entry) builds, and it may use core, the registry, tokens and the ./three entries of materials, primitives, objects, shaders, postfx and scenes, never adapters or React.",
      severity: "error",
      from: { path: "^packages/(scene)/src/", pathNot: "^packages/scene/src/three(\\.test)?\\.ts$" },
      to: { path: [anyPackage, "^three(/|$)", "(^|/)node_modules/three(/|$)", react], pathNot: [pkg("core"), "^(packages/$1/|@hedronite/lts-$1$)"] },
    },
    {
      name: "scene-three-builds-from-libraries",
      comment: "The scene package's ./three entry composes the libraries' ./three entries; it never imports adapters, React or an app.",
      severity: "error",
      from: { path: "^packages/scene/src/three(\\.test)?\\.ts$" },
      to: { path: [anyPackage, react], pathNot: [pkg("core|registry|tokens|materials|primitives|objects|shaders|postfx|scenes"), "^(packages/scene/|@hedronite/lts-scene$)"] },
    },
    {
      name: "no-deep-imports",
      comment: "Import other packages through their exports, never their src/.",
      severity: "error",
      from: { path: "^(packages|apps)/([^/]+)/" },
      to: { path: "^packages/([^/]+)/src/", pathNot: "^packages/$2/" },
    },
    {
      name: "products-never-import-tools",
      comment:
        "packages and apps never import tools/: code both need lives in a package. Matches the resolved path and the unresolved workspace name. " +
        "The one exception is a .glb model the asset pipeline builds, which the catalog serves as a file and does not run.",
      severity: "error",
      from: { path: "^(packages|apps)/" },
      to: { path: ["^tools/", "^(lumin|tool-[a-z]+|img-to-object)(/|$)"], pathNot: ["^tools/assets/dist/models/[^/]+\\.glb$", "^tool-assets/models/[^/]+\\.glb$"] },
    },
    {
      name: "registry-is-data-only",
      comment: "The registry lists assets for apps that must not load three.js to do it; it imports manifests and data, never a ./three entry.",
      severity: "error",
      from: { path: "^packages/registry/" },
      to: { path: ["^three(/|$)", "(^|/)node_modules/three(/|$)"] },
    },
    {
      name: "apps-are-leaves",
      comment: "Nothing imports an app.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules", "/dist/"] },
    exclude: { path: "(^|/)(coverage|\\.turbo)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
      extensions: [".ts", ".tsx", ".js", ".d.ts"],
    },
  },
};
