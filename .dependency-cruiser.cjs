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
      comment: "core depends on no other package.",
      severity: "error",
      from: { path: "^packages/core/" },
      to: { path: anyPackage, pathNot: pkg("core") },
    },
    {
      name: "only-core-is-shared",
      comment: "Libraries import core, not each other.",
      severity: "error",
      from: { path: "^packages/(icons|primitives|objects|materials|shaders)/" },
      to: { path: anyPackage, pathNot: [pkg("core"), "^(packages/$1/|@hedronite/lts-$1$)"] },
    },
    {
      name: "scenes-compose-only",
      comment: "scenes may compose primitives, materials and shaders, nothing else.",
      severity: "error",
      from: { path: "^packages/scenes/" },
      to: { path: anyPackage, pathNot: pkg("core|primitives|materials|shaders|scenes") },
    },
    {
      name: "pure-typescript-core",
      comment: "No React or React Three Fiber outside icons/react, adapters and the apps.",
      severity: "error",
      from: { path: ["^packages/(core|primitives|objects|scenes|materials|shaders)/", "^packages/icons/src/(?!react/)"] },
      to: { path: react },
    },
    {
      name: "no-deep-imports",
      comment: "Import other packages through their exports, never their src/.",
      severity: "error",
      from: { path: "^(packages|apps)/([^/]+)/" },
      to: { path: "^packages/([^/]+)/src/", pathNot: "^packages/$2/" },
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
