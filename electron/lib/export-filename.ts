/**
 * Turning a volume title into a filename.
 *
 * The volume title is the only volume-level label in this pipeline: Royal Road's bulk
 * import builds chapter titles from document headings, and arc boundaries are internal,
 * so the filename is what tells the author which volume a file holds. That makes it
 * worth getting right rather than letting the save dialog fail on a colon.
 *
 * Windows is the target because that is where the author is. It rejects `< > : " / \ |
 * ? *` and control characters, strips trailing dots and spaces, and reserves device
 * names. The same replacements are harmless on macOS and Linux, so nothing here is
 * platform-specific for the sake of it.
 */

/**
 * Characters no Windows path may contain, plus the two separators.
 *
 * The control-character range is the point rather than an accident: Windows rejects
 * U+0000 through U+001F in a path segment, and the author can paste one without
 * noticing. The rule flags any such range by default, which is right when parsing
 * untrusted input and wrong here, where matching them is the job itself.
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;

/** Names Windows keeps for devices, which cannot be used for a file. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])/i;

/** Used when a title has no character a filesystem will accept. */
const FALLBACK = 'untitled volume';

/**
 * The longest name most filesystems accept, in UTF-16 code units.
 *
 * Deliberately short of the usual 255. Windows measures a path in characters but the
 * limit applies to the whole path, and the author may be saving into a deep folder;
 * leaving room here means the name never has to be the thing that fails.
 */
const MAX_STEM_LENGTH = 180;

/**
 * Builds the `.docx` filename for a volume.
 *
 * @param volumeTitle - The volume's title, as the author typed it.
 * @returns A filename that Windows, macOS and Linux will all accept.
 */
export function toExportFileName(volumeTitle: string): string {
  return `${toSafeFileStem(volumeTitle)}.docx`;
}

/**
 * Reduces a title to a safe filename stem.
 *
 * Exported because the `.html` and archive exports need the same Windows-safety rules,
 * and a second implementation would eventually disagree about a colon.
 *
 * @param title - The author's title for the thing being written.
 * @returns A non-empty stem with no forbidden characters.
 */
export function toSafeFileStem(title: string): string {
  return buildStem(title);
}

/** Filename for a single chapter's `.html` export. */
export function toChapterHtmlFileName(chapterTitle: string): string {
  return `${toSafeFileStem(chapterTitle)}.html`;
}

/** Filename for the project archive. */
export function toArchiveFileName(projectTitle: string): string {
  return `${toSafeFileStem(projectTitle)}-archive.json`;
}

/**
 * Reduces a title to a safe path segment.
 *
 * Forbidden characters become spaces rather than dashes. A dash has to be trimmed off
 * both ends or the filename ends in punctuation, and a title that legitimately ends
 * in a forbidden character then produces a name that looks broken in the save dialog.
 * A space reads as the separator it replaced and needs no cleanup.
 *
 * @param volumeTitle - The volume's title.
 * @returns A non-empty segment with no forbidden character and no trailing dot or space.
 */
function buildStem(volumeTitle: string): string {
  const replaced = volumeTitle.replace(FORBIDDEN, ' ');

  // Windows silently strips trailing dots and spaces, which turns "Volume One." into
  // "Volume One" behind the author's back. Removing them here keeps the name they see
  // in the dialog identical to the name on disk.
  const trimmed = replaced.replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim();

  const usable = trimmed === '' ? FALLBACK : trimmed;
  const shortened =
    usable.length > MAX_STEM_LENGTH
      ? usable.slice(0, MAX_STEM_LENGTH).replace(/[. ]+$/, '')
      : usable;

  // Applied last: prefixing after truncation means a long title cannot be truncated
  // back into a reserved name.
  return RESERVED.test(shortened) ? `_${shortened}` : shortened;
}
