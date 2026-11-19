import { mountStill } from "./Still";
import { mountSceneStill } from "./sceneStill";

/**
 * The still-frame rig's page: `still.html?still=<asset id>`, or `still.html?scene=<fixture>&via=doc|code` for a scene document
 * (see STACK.md, "Still frames"). Its own entry, like the embed page, so nothing of it is in the chunks the catalog's visitors load.
 */
const root = document.getElementById("root");
if (root === null) throw new Error("missing #root element in still.html");
const params = new URLSearchParams(window.location.search);
const scene = params.get("scene");
if (scene === null) mountStill(root, params.get("still") ?? "");
else mountSceneStill(root, scene, params.get("via") ?? "doc", params.get("plant"));
