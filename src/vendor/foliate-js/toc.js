// Adaptador de índice para foliate-js.
export const flattenToc = (items = [], depth = 0) => items.flatMap((item) => [
  { label: item.label || item.title || "Sección", href: item.href, depth, subitems: item.subitems?.length ?? 0 },
  ...flattenToc(item.subitems ?? [], depth + 1),
]);
