import { mountStill } from "./Still";
import { mountDocumentStill, mountSceneStill } from "./sceneStill";

/**
 * The still-frame rig's page: `still.html?still=<asset id>`, `still.html?scene=<fixture>&via=doc|code` for a scene fixture, or
 * `still.html?doc=<s1. link>[&width=&height=]` for any scene document (`doc` alone waits for `window.stillScene.load(json)`;
 * see STACK.md, "Still frames"). Its own entry, like the embed page, so nothing of it is in the chunks the catalog's visitors load.
 */
const root = document.getElementById("root");
if (root === null) throw new Error("missing #root element in still.html");
const params = new URLSearchParams(window.location.search);
const scene = params.get("scene");
/** A side from the address: left out for the default, and anything that is not a whole number reaches the page as NaN, which it refuses by name. */
const side = (name: string): number | undefined => {
  const text = params.get(name);
  return text === null ? undefined : Number(text);
};
const doc = params.get("doc");
if (scene !== null) mountSceneStill(root, scene, params.get("via") ?? "doc", params.get("plant"));
else if (doc !== null) mountDocumentStill(root, doc === "" ? null : doc, { width: side("width"), height: side("height") });
else mountStill(root, params.get("still") ?? "");
