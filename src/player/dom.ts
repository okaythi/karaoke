/** The element with this id. The page's markup is fixed, so a missing one is a build mistake worth failing on. */
export function byId<T extends Element = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`The page has no #${id} element`);
  return element as unknown as T;
}
