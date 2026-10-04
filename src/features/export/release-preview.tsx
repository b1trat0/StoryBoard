import { CheckCircle, Warning, WarningCircle } from '@phosphor-icons/react';
import type { ChapterRelease, ReleaseWarning } from '../../lib/bridge';
import { EmptyState } from '../../components/ui/empty-state';
import { useReleasePreview } from './use-release-preview';

/**
 * Release preview.
 *
 * The first step of the export pipeline, and the only one that changes nothing. It
 * exists because every failure it catches is invisible in the source text: a `*`
 * that publishes as a literal asterisk, an image that lands two paragraphs late, an
 * alt text containing a quote that swallows the rest of the tag. All of them
 * produce a file, and Royal Road has no API, so the last step is the author
 * pasting that file into a browser form by hand.
 *
 * The body is rendered as the HTML that will be sent, not as a re-render of the
 * author's markdown. A preview that reformats for display would hide exactly the
 * differences it exists to reveal.
 */

export interface ReleasePreviewProps {
  /** Chapter to preview, or null when none is selected. */
  chapterId: string | null;
  isOutlineLoading: boolean;
}

export function ReleasePreview({ chapterId, isOutlineLoading }: ReleasePreviewProps) {
  const { release, isLoading, errorMessage, reload } = useReleasePreview(chapterId);

  if (chapterId === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <EmptyState
            title="Pick a chapter to preview"
            body="The preview shows the chapter exactly as Royal Road will receive it, including where each image lands."
          />
        </div>
      </div>
    );
  }

  if (errorMessage !== null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-md">
          <EmptyState
            icon={<WarningCircle size={26} />}
            title="Could not build the preview"
            body={errorMessage}
            action={
              <button
                type="button"
                onClick={() => void reload()}
                className="rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-soft hover:bg-surface-sunken"
              >
                Try again
              </button>
            }
          />
        </div>
      </div>
    );
  }

  if (isLoading || release === null) {
    return (
      <div
        role="status"
        className="flex flex-1 items-center justify-center p-8 text-[13px] text-ink-muted"
      >
        {isOutlineLoading ? 'Loading the outline…' : 'Building the preview…'}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <header className="border-b border-line pb-5">
          <h1 className="font-serif text-xl font-semibold text-ink">{release.title}</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {release.wordCount.toLocaleString('en-US')} words
            {release.isExcluded ? ' · not part of this release' : ''}
          </p>
        </header>

        <WarningList warnings={release.warnings} />
        <ExcludedNotice release={release} />

        {/*
          Royal Road's form puts Author Notes outside Chapter Content, so the notes
          are shown as their own sections rather than folded into the body. Folding
          them in would misrepresent where they land, and would make a note look like
          prose the author has to delete.
        */}
        {release.preNoteHtml !== '' && (
          <NoteBlock label="Pre-chapter note" html={release.preNoteHtml} />
        )}

        {/*
          The published body.

          This HTML is rendered rather than reconstructed from the chapter because a
          reconstruction would be a second implementation of the export rules, and the
          two would disagree eventually. Everything in it was escaped on the way out of
          the converter: prose through escapeHtmlText, alt text and URLs through
          escapeHtmlAttribute, dimensions as validated integers.
        */}
        <article
          data-testid="release-body"
          className="release-preview mt-6 font-serif text-[15px] leading-[1.75] text-ink"
          dangerouslySetInnerHTML={{ __html: renderBody(release) }}
        />

        {release.postNoteHtml !== '' && (
          <NoteBlock label="Post-chapter note" html={release.postNoteHtml} />
        )}
      </div>
    </div>
  );
}

/**
 * Joins the body blocks with the paragraph gap Royal Road expects.
 *
 * `<br /><br />` between blocks is already decided by the converter; the only choice
 * left here is where an image and its caption go, which is after the paragraph it is
 * anchored to. Author notes are not in here: Royal Road renders them outside the
 * chapter content, so they get their own sections.
 */
function renderBody(release: ChapterRelease): string {
  const parts: string[] = [];
  for (const block of release.blocks) {
    if (block.kind === 'paragraph') {
      parts.push(block.html);
      continue;
    }
    parts.push(block.imageHtml);
    if (block.captionHtml !== '') {
      parts.push(`<em>${block.captionHtml}</em>`);
    }
  }
  return parts.join('<br /><br />');
}

/**
 * Renders one author note as its own labelled section.
 *
 * Separate from the body because Royal Road renders author notes outside the
 * chapter content. Folding them into the prose would misrepresent where they land.
 */
function NoteBlock({ label, html }: { label: string; html: string }) {
  return (
    <section className="mt-6 border-t border-line pt-4">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </h2>
      <div
        className="release-preview mt-2 font-serif text-[14px] leading-relaxed text-ink-soft"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  );
}

/** Banner for a chapter that will not be in the exported output. */
function ExcludedNotice({ release }: { release: ChapterRelease }) {
  if (!release.isExcluded || release.exclusionReason === null) {
    return null;
  }
  return (
    <p className="mt-5 flex items-start gap-2.5 rounded-md border border-line bg-surface-sunken px-3.5 py-3 text-[13px] leading-relaxed text-ink-soft">
      <Warning size={17} weight="bold" aria-hidden="true" className="mt-px shrink-0 text-ink-muted" />
      <span>{release.exclusionReason}</span>
    </p>
  );
}

/**
 * Everything that stands between this chapter and a clean publish.
 *
 * Blockers first. A list where a missing alt text sits beside a note about word
 * count is a list the author skims, and the one that matters gets skimmed too.
 */
function WarningList({ warnings }: { warnings: ReleaseWarning[] }) {
  if (warnings.length === 0) {
    return (
      <p className="mt-6 flex items-center gap-2 text-[13px] text-accent">
        <CheckCircle size={17} weight="bold" aria-hidden="true" />
        Ready to publish. Royal Road will accept this chapter as it appears here.
      </p>
    );
  }

  const blockers = warnings.filter((warning) => warning.severity === 'blocker');
  const advisories = warnings.filter((warning) => warning.severity === 'warning');

  return (
    <section className="mt-6 space-y-2" aria-label="Publishing problems">
      {blockers.length > 0 && <WarningGroup tone="danger" warnings={blockers} />}
      {advisories.length > 0 && <WarningGroup tone="muted" warnings={advisories} />}
    </section>
  );
}

function WarningGroup({
  tone,
  warnings,
}: {
  tone: 'danger' | 'muted';
  warnings: ReleaseWarning[];
}) {
  return (
    <ul
      className={
        tone === 'danger'
          ? 'space-y-1.5 rounded-md border border-danger/25 bg-danger-soft px-3.5 py-3'
          : 'space-y-1.5 rounded-md border border-line bg-surface-sunken px-3.5 py-3'
      }
    >
      {warnings.map((warning) => (
        <li key={`${warning.code}-${warning.message}`} className="flex items-start gap-2.5">
          <WarningCircle
            size={16}
            weight="bold"
            aria-hidden="true"
            className={
              tone === 'danger'
                ? 'mt-px shrink-0 text-danger'
                : 'mt-px shrink-0 text-ink-muted'
            }
          />
          <span
            className={
              tone === 'danger'
                ? 'text-[13px] leading-relaxed text-danger'
                : 'text-[13px] leading-relaxed text-ink-soft'
            }
          >
            {warning.message}
          </span>
        </li>
      ))}
    </ul>
  );
}