/**
 * Paragraph counting for the renderer.
 *
 * Mirrors the main process's paragraph rule: a blank line is a paragraph break, a
 * single newline is not. Illustration anchors are paragraph indexes, so the editor
 * has to count the same way the export does or the anchor warning lies.
 *
 * @param bodyMd - Chapter prose.
 * @returns Number of non-empty paragraphs.
 */
export function countParagraphs(bodyMd: string): number {
  return bodyMd
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0).length;
}
