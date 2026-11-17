// JSX as a table: every element in a set of TSX files, with its attributes, class string and text.
// No rules here. The lumin-ui skill's Nushell body holds the rules and runs them over this table, so a
// rule is a pipeline anyone can read, and the parsing is done once, properly, by the TypeScript parser.
import { readFileSync } from "node:fs";
import ts from "typescript";

/** One JSX element. Attribute values are the literal string, `true` for a bare attribute, or `{…}` source for an expression. */
export interface UiElement {
  readonly file: string;
  readonly line: number;
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string | true>>;
  /** The className, when it is a string literal or a template with literal parts (the parts joined by spaces). */
  readonly class: string;
  /** The element's own text children, trimmed and joined. */
  readonly text: string;
  /** Its children are only icons: <svg>, or a component whose name ends in Icon or comes from an icon module. */
  readonly iconOnly: boolean;
  /** The number of element children. */
  readonly children: number;
  /** Children that are expressions other than a string literal (`{name}`, `{items.map(…)}`): content the source can't show. */
  readonly dynamic: number;
  /** The tags of its element ancestors, nearest first. */
  readonly ancestors: readonly string[];
  /** This element's index in its file's rows, and its nearest element ancestor's (-1 at the top). */
  readonly index: number;
  readonly parent: number;
}

const ICON_MODULES = /icons(\/react)?$|lucide|heroicons/;

/** Literal text a className expression is built from: string literals, template heads and spans, ternary arms. */
function classText(node: ts.Node | undefined): string {
  if (node === undefined) return "";
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return classText(node.expression);
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => `${classText(span.expression)} ${span.literal.text}`)].join(" ");
  if (ts.isConditionalExpression(node)) return `${classText(node.whenTrue)} ${classText(node.whenFalse)}`;
  if (ts.isBinaryExpression(node)) return `${classText(node.left)} ${classText(node.right)}`;
  if (ts.isParenthesizedExpression(node)) return classText(node.expression);
  if (ts.isCallExpression(node)) return node.arguments.map((arg) => classText(arg)).join(" ");
  if (ts.isIdentifier(node)) return `{${node.text}}`;
  return "";
}

const tagName = (name: ts.JsxTagNameExpression): string => name.getText();

/** The table of JSX elements in one source file. */
export function uiFacts(file: string, text: string): readonly UiElement[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const iconNames = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && ICON_MODULES.test(statement.moduleSpecifier.text)) {
      const named = statement.importClause?.namedBindings;
      if (named !== undefined && ts.isNamedImports(named)) for (const element of named.elements) iconNames.add(element.name.text);
    }
  }
  const isIcon = (tag: string): boolean => tag === "svg" || tag.endsWith("Icon") || iconNames.has(tag);
  const out: UiElement[] = [];
  const visit = (node: ts.Node, parent: number, ancestors: readonly string[]): void => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined;
    if (opening !== undefined) {
      const attrs: Record<string, string | true> = {};
      let className: ts.Node | undefined;
      for (const prop of opening.attributes.properties) {
        if (ts.isJsxSpreadAttribute(prop)) {
          attrs["{...}"] = `{...${prop.expression.getText()}}`;
          continue;
        }
        const name = prop.name.getText();
        const init = prop.initializer;
        if (name === "className") className = init;
        attrs[name] = init === undefined ? true : ts.isStringLiteral(init) ? init.text : init.getText();
      }
      const kids: readonly ts.JsxChild[] = ts.isJsxElement(node) ? node.children : [];
      const elements = kids.filter((child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child));
      const words = kids
        .filter(ts.isJsxText)
        .map((child) => child.text.replace(/\s+/g, " ").trim())
        .filter((t) => t !== "");
      const dynamic = kids.filter((child) => ts.isJsxExpression(child) && child.expression !== undefined && !ts.isStringLiteral(child.expression)).length;
      const literal = kids.flatMap((child) => (ts.isJsxExpression(child) && child.expression !== undefined && ts.isStringLiteral(child.expression) ? [child.expression.text] : []));
      const childTag = (child: ts.JsxChild): string => (ts.isJsxElement(child) ? tagName(child.openingElement.tagName) : ts.isJsxSelfClosingElement(child) ? tagName(child.tagName) : "");
      out.push({
        file,
        line: source.getLineAndCharacterOfPosition(opening.getStart(source)).line + 1,
        tag: tagName(opening.tagName),
        attrs,
        class: classText(className).replace(/\s+/g, " ").trim(),
        text: [...words, ...literal].join(" "),
        iconOnly: elements.length > 0 && words.length === 0 && literal.length === 0 && dynamic === 0 && elements.every((child) => isIcon(childTag(child))),
        children: elements.length,
        dynamic,
        ancestors,
        index: out.length,
        parent,
      });
      const self = out.length - 1;
      const inside = [tagName(opening.tagName), ...ancestors];
      ts.forEachChild(node, (child) => {
        visit(child, self, inside);
      });
      return;
    }
    ts.forEachChild(node, (child) => {
      visit(child, parent, ancestors);
    });
  };
  visit(source, -1, []);
  return out;
}

/** The table for several files, read from disk. */
export const uiFactsFor = (files: readonly string[]): readonly UiElement[] => files.flatMap((file) => uiFacts(file, readFileSync(file, "utf8")));
