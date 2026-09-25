/**
 * Scroll helper shared by the drawer and the two settings systems.
 *
 * Guarded on purpose: jsdom (used by the unit tests) and a few embedded
 * webviews do not implement `Element.prototype.scrollIntoView`, and a missing
 * scroll must never break the settings wiring.
 *
 * @param {Element|null|undefined} element
 */
export function scrollIntoViewSafe(element) {
  if (element && typeof element.scrollIntoView === "function") {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
