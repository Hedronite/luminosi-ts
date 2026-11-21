import { defineSceneElement } from "@hedronite/lts-scene/element";

// The test page for `<lts-scene>` (element.html): it registers the element and nothing else, so what a page loads for the element is what the package ships.
// `?only=a,b` keeps the instances with those ids and removes the rest before the element is defined, so a test can load one case on its own.
const only = new URLSearchParams(location.search).get("only");
if (only !== null) {
  const keep = new Set(only.split(","));
  for (const instance of document.querySelectorAll("lts-scene")) if (!keep.has(instance.id)) instance.remove();
}
defineSceneElement();
