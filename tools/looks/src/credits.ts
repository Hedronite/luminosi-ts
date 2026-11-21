// The credit of a look that is someone else's work, as the core package holds it (`Credit` in packages/core, kind "look").
// It comes from the look's existing credit text in its looks.json ("Gruvbox by Pavel Pertsev (morhetz), MIT") and the folder's source address,
// which pins the commit the palettes were taken at.

/** What a look's credit says: the thing, how it stands to its source, the source at its pin, the terms, the author, and the file in the source. */
export interface LookCredit {
  readonly subject: string;
  readonly kind: "look";
  readonly relation: "ported";
  readonly work: string;
  readonly source: string;
  readonly pin: string;
  readonly license: string;
  readonly credit: string;
  readonly path: string;
}

export interface LookCreditInput {
  /** The look's id. */
  readonly id: string;
  readonly name: string;
  /** The credit text from looks.json: "<who>, <license>", then any notes after a semicolon. */
  readonly credit: string;
  /** The id of the palette folder the colors came from: the look's own, or the dark one of a pair. */
  readonly palette: string;
  /** The folder's source address: a GitHub tree address at a full commit. */
  readonly source: string;
}

/** A license id as the credit text spells it: SPDX ids, joined by OR or AND. */
const licenseId = /^[A-Za-z0-9.+-]+(?: (?:OR|AND) [A-Za-z0-9.+-]+)*$/;
const treeAddress = /^(https:\/\/github\.com\/[\w.-]+\/[\w.-]+)\/tree\/([0-9a-f]{40})\/([\w./-]+)$/;

/** A folder whose looks are the project's own carries no credit: its license line starts "First-party". */
export const isFirstParty = (license: string): boolean => /^first-party\b/i.test(license);

/** The credit of one look. Throws, naming the look, if its text has no license after its last comma or the source is not a GitHub tree at a commit. */
export function lookCredit({ id, name, credit, palette, source }: LookCreditInput): LookCredit {
  const [main = "", ...notes] = credit.split("; ");
  const cut = main.lastIndexOf(", ");
  const who = main.slice(0, Math.max(cut, 0));
  const license = main.slice(cut + 2);
  if (cut <= 0 || !licenseId.test(license)) throw new Error(`look "${id}": the credit "${credit}" does not read "<who>, <license>"`);
  const tree = treeAddress.exec(source);
  if (tree === null) throw new Error(`look "${id}": the source "${source}" is not a GitHub tree address at a full commit`);
  const [, repository = "", pin = "", directory = ""] = tree;
  return {
    subject: id,
    kind: "look",
    relation: "ported",
    work: [`${name} color scheme`, ...notes].join("; "),
    source: repository,
    pin,
    license,
    credit: who,
    path: `${directory}/${palette}/colors.toml`,
  };
}
