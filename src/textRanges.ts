export function selectionOffsets(root: Element, range: Range) {
  const before = range.cloneRange();
  before.selectNodeContents(root);
  try {
    before.setEnd(range.startContainer, range.startOffset);
  } catch {
    return { start: 0, end: 0 };
  }
  const start = before.toString().length;
  const through = range.cloneRange();
  through.selectNodeContents(root);
  try {
    through.setEnd(range.endContainer, range.endOffset);
  } catch {
    return { start, end: start };
  }
  return { start, end: through.toString().length };
}

export function rangeFromOffsets(root: Node, start: number, end: number): Range | null {
  if (end <= start) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let position = 0;
  let startNode: Text | null = null;
  let startLocal = 0;
  let endNode: Text | null = null;
  let endLocal = 0;
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    const length = text.data.length;
    const next = position + length;
    if (!startNode && start >= position && start <= next) {
      startNode = text;
      startLocal = Math.max(0, Math.min(length, start - position));
    }
    if (!endNode && end >= position && end <= next) {
      endNode = text;
      endLocal = Math.max(0, Math.min(length, end - position));
      break;
    }
    position = next;
    node = walker.nextNode();
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startLocal);
  range.setEnd(endNode, endLocal);
  return range;
}

export function wordRangeAtPoint(x: number, y: number): Range | null {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = documentWithCaret.caretPositionFromPoint?.(x, y);
  let node: Node | null = null;
  let offset = 0;
  if (position) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    const caret = documentWithCaret.caretRangeFromPoint?.(x, y);
    if (!caret) return null;
    node = caret.startContainer;
    offset = caret.startOffset;
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node as Text;
  const data = text.data;
  const isWord = (character: string) => /[\p{L}\p{N}’'-]/u.test(character);
  let start = offset;
  let end = offset;
  while (start > 0 && isWord(data[start - 1])) start -= 1;
  while (end < data.length && isWord(data[end])) end += 1;
  if (end <= start) return null;
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  return range;
}
