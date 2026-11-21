// The license policy (SPEC-wave9 E2, R15, R24): what each license in the vendored folders lets LuminosiTS do with a file. A pin's `licenses`
// says which license covers which paths; this table says what each license permits; `lumin adopt` and `lumin adopt-skill` refuse what it forbids.
import { matchesGlob, type LicenseEntry, type Pin } from "./pin.js";

export type PolicyClass = "adopt" | "adopt-with-attribution" | "showcase-only" | "forbidden";

export interface PolicyEntry {
  readonly class: PolicyClass;
  /** One line: why the license is in this class. */
  readonly reason: string;
}

/** Every license in use, by SPDX id (LicenseRef-* where SPDX has none), and what it permits. */
export const POLICY: Readonly<Record<string, PolicyEntry>> = {
  "CC0-1.0": { class: "adopt", reason: "a public-domain dedication: no condition on copying" },
  "LicenseRef-PublicDomain": { class: "adopt", reason: "a work in the public domain (a US government work, or one whose term has run out): no condition on copying" },
  MIT: { class: "adopt-with-attribution", reason: "permissive: the copyright and permission notice must travel with every copy" },
  ISC: { class: "adopt-with-attribution", reason: "permissive: the copyright and permission notice must travel with every copy" },
  "Apache-2.0": { class: "adopt-with-attribution", reason: "permissive: keeps the notice and states the changes made" },
  "BSD-2-Clause": { class: "adopt-with-attribution", reason: "permissive: the copyright notice must travel with every copy" },
  "BSD-3-Clause": { class: "adopt-with-attribution", reason: "permissive: the copyright notice must travel with every copy, and the author's name is not used to endorse" },
  "CC-BY-4.0": { class: "adopt-with-attribution", reason: "a credit to the author, the license named and the changes stated" },
  "OFL-1.1": { class: "showcase-only", reason: "font software: the library ships and ports no fonts, so a font may be shown and studied here and nowhere else" },
  "LicenseRef-ThirdPartyScreenshots": {
    class: "showcase-only",
    reason: "pictures of other people's scenes and data (CC BY 4.0, ODbL, Unreal Engine content): the repository's MIT covers the screenshot, not what it shows",
  },
};

/** License families that are refused by name, so the reason says why (everything the table does not know is refused too). */
const FORBIDDEN_FAMILIES: readonly (readonly [RegExp, string])[] = [
  [/^A?GPL-/, "a copyleft license: code under it cannot be copied into the MIT OR Apache-2.0 packages"],
  [/^LGPL-/, "a copyleft license: code under it cannot be copied into the MIT OR Apache-2.0 packages"],
  [/^CC-BY-NC/, "a non-commercial license: it does not let the packages be used for any purpose"],
];

const RANK: Readonly<Record<PolicyClass, number>> = { adopt: 0, "adopt-with-attribution": 1, "showcase-only": 2, forbidden: 3 };

/** What a license (or an SPDX expression) comes to. `known` is false when any id in it is not in the table. */
export interface Classification {
  readonly class: PolicyClass;
  readonly reason: string;
  readonly ids: readonly string[];
  readonly unknown: readonly string[];
}

const worse = (a: Classification, b: Classification): Classification => (RANK[b.class] > RANK[a.class] ? b : a);
const better = (a: Classification, b: Classification): Classification => (RANK[b.class] < RANK[a.class] ? b : a);

function ofId(id: string): Classification {
  const base = id.endsWith("+") ? id.slice(0, -1) : id;
  const known = POLICY[base];
  if (known !== undefined) return { class: known.class, reason: known.reason, ids: [id], unknown: [] };
  const family = FORBIDDEN_FAMILIES.find(([pattern]) => pattern.test(base));
  if (family !== undefined) return { class: "forbidden", reason: family[1], ids: [id], unknown: [] };
  return { class: "forbidden", reason: `${id} is not in the license policy, and what the policy does not know it refuses`, ids: [id], unknown: [id] };
}

/** `MIT`, `MIT OR Apache-2.0`, `(MIT AND CC-BY-4.0)`, `GPL-2.0-only WITH Classpath-exception-2.0`: OR takes the most permissive class, AND the most restrictive, WITH counts as its base license. */
export function classify(expression: string): Classification {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const fail = (): never => {
    throw new Error(`"${expression}" is not an SPDX license expression`);
  };
  const atom = (): Classification => {
    const token = peek();
    if (token === undefined) return fail();
    at += 1;
    if (token === "(") {
      const inner = or();
      if (peek() !== ")") return fail();
      at += 1;
      return inner;
    }
    if (token === ")" || token === "AND" || token === "OR" || token === "WITH") return fail();
    if (peek() === "WITH") {
      at += 1;
      const exception = peek();
      if (exception === undefined || exception === "(" || exception === ")" || exception === "AND" || exception === "OR") return fail();
      at += 1;
    }
    return ofId(token);
  };
  const and = (): Classification => {
    let result = atom();
    while (peek() === "AND") {
      at += 1;
      const next = atom();
      result = { ...worse(result, next), ids: [...result.ids, ...next.ids], unknown: [...result.unknown, ...next.unknown] };
    }
    return result;
  };
  function or(): Classification {
    let result = and();
    while (peek() === "OR") {
      at += 1;
      const next = and();
      result = { ...better(result, next), ids: [...result.ids, ...next.ids], unknown: [...result.unknown, ...next.unknown] };
    }
    return result;
  }
  const whole = or();
  if (at !== tokens.length) return fail();
  return whole;
}

// ---- a pin's licenses, path by path ------------------------------------------------------------------------------------

/** The entry that covers a path of a folder, or undefined: an entry naming the path wins; otherwise the folder's `remainder` entry. A path two entries name is an error elsewhere (`coverageProblems`). */
export function entryFor(licenses: readonly LicenseEntry[], path: string): LicenseEntry | undefined {
  return licenses.find((entry) => entry.paths?.some((pattern) => matchesGlob(pattern, path)) === true) ?? licenses.find((entry) => entry.remainder === true);
}

/** The rule that governs a path: the license, what it comes to, and which entry said so. */
export interface Rule {
  readonly spdx: string;
  readonly class: PolicyClass;
  readonly reason: string;
  /** The globs the entry names, or `remainder`. */
  readonly covers: string;
}

/** The license rule of a path inside a pinned folder; undefined when the pin has no `licenses` or none covers the path. */
export function ruleOf(pin: Pin | undefined, path: string): Rule | undefined {
  if (pin?.licenses === undefined) return undefined;
  const entry = entryFor(pin.licenses, path);
  if (entry === undefined) return undefined;
  const found = classify(entry.spdx);
  return { spdx: entry.spdx, class: found.class, reason: found.reason, covers: entry.remainder === true ? "remainder" : (entry.paths ?? []).join(", ") };
}

/** Whether a rule lets a file be ported or adopted. */
export const adoptable = (rule: Rule): boolean => rule.class === "adopt" || rule.class === "adopt-with-attribution";

/**
 * What is wrong with a pin's `licenses` for the files its folder holds, in words; empty when they are sound:
 * a folder without `licenses`, a license the table does not know or does not parse, an entry that names nothing or both paths and `remainder`,
 * more than one `remainder`, a path two entries name, a path no entry covers, an entry whose paths match no file.
 */
export function coverageProblems(folder: string, pin: Pin, files: readonly string[]): readonly string[] {
  const where = `assets/vendor/${folder}/vendor.json`;
  const licenses = pin.licenses;
  if (licenses === undefined || licenses.length === 0) return [`${where}: no licenses: a folder says which license covers which paths`];
  const problems: string[] = [];
  for (const entry of licenses) {
    try {
      const found = classify(entry.spdx);
      if (found.unknown.length > 0) problems.push(`${where}: ${found.unknown.join(", ")} is not in the license policy`);
    } catch (error: unknown) {
      problems.push(`${where}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if ((entry.paths === undefined) === (entry.remainder !== true)) problems.push(`${where}: the ${entry.spdx} entry names paths or is the remainder, one of the two`);
  }
  if (licenses.filter((entry) => entry.remainder === true).length > 1) problems.push(`${where}: more than one remainder entry`);
  for (const entry of licenses) {
    if (entry.paths !== undefined && !files.some((file) => entry.paths?.some((pattern) => matchesGlob(pattern, file)) === true)) {
      problems.push(`${where}: the ${entry.spdx} entry for ${entry.paths.join(", ")} matches no file of the folder`);
    }
  }
  const double: string[] = [];
  const bare: string[] = [];
  for (const file of files) {
    const named = licenses.filter((entry) => entry.paths?.some((pattern) => matchesGlob(pattern, file)) === true);
    if (named.length > 1) double.push(`${file} (${named.map((entry) => entry.spdx).join(" and ")})`);
    if (named.length === 0 && !licenses.some((entry) => entry.remainder === true)) bare.push(file);
  }
  const some = (list: readonly string[]): string => `${list.slice(0, 3).join(", ")}${list.length > 3 ? ` and ${String(list.length - 3)} more` : ""}`;
  if (double.length > 0) problems.push(`${where}: ${String(double.length)} paths are covered by two entries: ${some(double)}`);
  if (bare.length > 0) problems.push(`${where}: ${String(bare.length)} paths are covered by no entry: ${some(bare)}`);
  return problems;
}

/**
 * What is wrong with an asset's `origin` for the pin of its folder, or undefined: a port or an adoption (`ported`, `adopted`) must come from a path the
 * policy lets be ported; work only `inspired` by another copies nothing, so it passes unless the path is forbidden outright.
 */
export function originProblem(pin: Pin | undefined, origin: { readonly vendor: string; readonly relation: string; readonly path: string }): string | undefined {
  const rule = ruleOf(pin, origin.path);
  const from = `assets/vendor/${origin.vendor}/${origin.path}`;
  if (rule === undefined) return `${from} has no license rule in its folder's vendor.json`;
  if (origin.relation === "inspired") return rule.class === "forbidden" ? `${from} is under ${rule.spdx}, which is forbidden: ${rule.reason}` : undefined;
  return adoptable(rule) ? undefined : `${from} is ${origin.relation} but is under ${rule.spdx}, which is ${rule.class}: ${rule.reason}`;
}
