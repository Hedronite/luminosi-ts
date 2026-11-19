import { mountStill } from "./Still";

/**
 * The still-frame rig's page: `still.html?still=<asset id>` (see STACK.md, "Still frames"). Its own entry, like the embed page,
 * so nothing of it is in the chunks the catalog's visitors load.
 */
const root = document.getElementById("root");
if (root === null) throw new Error("missing #root element in still.html");
mountStill(root, new URLSearchParams(window.location.search).get("still") ?? "");
