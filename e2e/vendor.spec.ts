import { expect, test } from "./fixtures.js";

test("Codevember's days are demos with their notes readable in place and a live link", async ({ page }) => {
  await page.goto("/?view=open-source");
  await page.getByRole("button", { name: /^Codevember 2026/ }).click();
  await expect(page.getByTestId("folder-credit")).toContainText("Theo Tillberg");
  await expect(page.getByTestId("folder-credit")).toContainText("MIT");
  const orrery = page.getByRole("listitem").filter({ hasText: "06 / Orrery" });
  await expect(orrery.getByRole("link", { name: /Open the 06 \/ Orrery demo/ })).toHaveAttribute("href", "https://ttillberg.github.io/codevember-2026/06/");
  await orrery.getByRole("button", { name: "Read 06 / Orrery" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "06 / Orrery" })).toBeVisible();
  await expect(page.getByText(/cat's eye marbles/).first()).toBeVisible();
});

test("ThreeRT sits under Engines, with its docs readable page by page", async ({ page }) => {
  await page.goto("/?view=open-source");
  await expect(page.getByRole("heading", { name: "Engines" })).toBeVisible();
  await page.getByRole("button", { name: /^ThreeRT/ }).click();
  await expect(page.getByTestId("folder-credit")).toContainText("Meshy LLC");
  await page.getByRole("button", { name: /^Read Documentation/ }).click();
  const pages = page.getByRole("combobox", { name: "Page" });
  await expect(pages).toBeVisible();
  expect(await pages.locator("option").count()).toBeGreaterThan(5);
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await expect(page.locator("article").getByRole("paragraph").first()).toBeVisible();
});

test("work ported from a vendored folder is listed under it and credits it from the asset's details", async ({ page }) => {
  await page.goto("/?view=open-source&set=codevember-2026");
  const library = page.getByRole("region", { name: "In the library" });
  await expect(library).toContainText("07/src/Balloon.tsx");
  await expect(page.getByRole("listitem").filter({ hasText: "07 / Hollow" })).toContainText("In the library: Soap film");
  await library.getByRole("button", { name: /Soap film/ }).click();
  const dialog = page.getByRole("dialog", { name: "Soap film" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "codevember-2026" })).toHaveAttribute("href", "?view=open-source&set=codevember-2026");
  await expect(dialog).toContainText("07/src/Balloon.tsx");
});

test("the CRT screen effect credits ThreeUI", async ({ page }) => {
  await page.goto("/?asset=crt");
  const dialog = page.getByRole("dialog", { name: "CRT screen" });
  await expect(dialog).toContainText("Adopted from");
  await expect(dialog).toContainText("src/shaders/crt/crtShaders.ts");
});
test("a fetched folder shows its pin: commit link, license id, class, changes, and that it is fetched", async ({ page }) => {
  await page.goto("/?view=open-source&set=coreui-icons");
  const credit = page.getByTestId("folder-credit");
  await expect(page.getByTestId("folder-license-id")).toContainText("CC-BY-4.0 AND MIT");
  await expect(page.getByTestId("folder-policies")).toContainText("adoptable with attribution");
  await expect(page.getByTestId("folder-policies")).toContainText("CC-BY-4.0 · 562 files");
  await expect(page.getByTestId("folder-policies")).toContainText("MIT · 1 file");
  // The raw-file count is labelled: it leaves out the license and credit files the bigger index size counts.
  await expect(page.getByTestId("folder-license-id")).toContainText("563 files, not counting license and credit files");
  await expect(page.getByTestId("folder-transformations")).toContainText("include");
  await expect(page.getByTestId("folder-transformations")).toContainText("the build and demo code");
  await expect(page.getByTestId("folder-vendored")).toContainText("Fetched by pin");
  // The commit link is upstream at that commit, never a branch.
  const source = page.getByTestId("folder-sources").getByRole("link");
  await expect(source).toHaveAttribute("href", "https://github.com/coreui/coreui-icons/tree/88d1cfc47fc3cc84114de2a01b04db11a941bdf9");
  await expect(credit).toContainText("88d1cfc4");
});
test("the kept folder says it is kept, and names no repository", async ({ page }) => {
  await page.goto("/?view=open-source&set=isocons");
  await expect(page.getByTestId("folder-vendored")).toContainText("Kept in the repo");
  await expect(page.getByTestId("folder-sources")).toContainText("No repository");
  await expect(page.getByTestId("folder-sources")).toContainText("isocons.app");
  await expect(page.getByTestId("folder-license-id")).toContainText("6037 files");
  await expect(page.getByTestId("folder-transformations")).toContainText("None recorded: copied from the site's published bundle, not from a commit.");
  await expect(page.getByTestId("folder-sources").getByRole("link")).toHaveCount(0);
});
test("a folder with several repositories links each one at its own commit", async ({ page }) => {
  await page.goto("/?view=open-source&set=techartist");
  const links = page.getByTestId("folder-sources").getByRole("link");
  await expect(links).toHaveCount(3);
  await expect(links.filter({ hasText: "geometry-in-flux" })).toHaveAttribute("href", "https://github.com/iamtechartist/geometry-in-flux/tree/da187f6316c7ee18b8f1b60bbb5363be2aec40c2");
  await expect(links.filter({ hasText: "bioluminescence" })).toHaveAttribute("href", "https://github.com/iamtechartist/bioluminescence/tree/2dc70cfd855704c1a8385f606e82f41505fdd5e9");
  await expect(links.filter({ hasText: "Threejs-3D-Webpage" })).toHaveAttribute("href", "https://github.com/iamtechartist/Threejs-3D-Webpage/tree/d827a2a409abc44ff35b4965e3d3aadfbe66278a");
  // Three repositories laid out as three subfolders of one: the layout is a transformation of its own.
  await expect(page.getByTestId("folder-transformations")).toContainText("layout");
  await expect(page.getByTestId("folder-transformations")).toContainText("Three repositories laid out as three subfolders");
  await expect(page.getByTestId("folder-policies").getByRole("listitem")).toHaveCount(1);
});
test("a ported asset carries its origin's commit, license and changes under its folder", async ({ page }) => {
  await page.goto("/?view=open-source&set=codevember-2026");
  const library = page.getByRole("region", { name: "In the library" });
  const card = library.getByRole("listitem").filter({ hasText: "Soap film" });
  await expect(card).toContainText("from 07/src/Balloon.tsx");
  // The link's accessible name says what it is and contains its visible text.
  const commitLink = card.getByRole("link", { name: "Soap film at commit 4df8e67a" });
  await expect(commitLink).toHaveAttribute("href", "https://github.com/ttillberg/codevember-2026/tree/4df8e67ab6584b3c354f06f0f9ce9a4348f82dbe");
  await expect(commitLink).toContainText("4df8e67a");
  await expect(card).toContainText("MIT");
  await expect(card).toContainText("standalone surface shader");
});
test("policy rows with the same class and license are shown once, their files added up", async ({ page }) => {
  await page.goto("/?view=open-source&set=threert");
  const policies = page.getByTestId("folder-policies");
  // ThreeRT names adoptable-with-attribution MIT twice (30 and 763 files): one row, 793 files.
  const mit = policies.getByRole("listitem").filter({ hasText: "MIT" });
  await expect(mit.filter({ hasText: "793 files" })).toHaveCount(1);
  const rows = await policies.getByRole("listitem").allTextContents();
  expect(rows.filter((row) => row.includes("793 files"))).toHaveLength(1);
  expect(rows.some((row) => row.includes("30 files"))).toBe(false);
});
