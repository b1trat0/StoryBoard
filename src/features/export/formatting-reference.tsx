import { ArrowRight, Prohibit } from '@phosphor-icons/react';
import {
  FORMATTING_GROUPS,
  UNSUPPORTED_CONSTRUCTS,
  UNDERLINE_GAP,
  type FormattingExample,
} from './formatting-examples';

/**
 * The formatting reference.
 *
 * The author writes plain markdown and this app translates it at export, so the one
 * question that matters while writing is "how do I type that". Answering it from
 * memory is how a chapter ends up with literal asterisks in it, so the answers are on
 * screen instead.
 *
 * Every example here is asserted against the real converter in
 * `tests/unit/formatting-examples.test.ts`. This screen reads that data rather than
 * restating it, so the two cannot disagree: if the conversion changes, the test fails
 * before the screen can start lying.
 *
 * The "becomes" side is rendered as HTML so the author sees the actual result — bold
 * text really is bold here, which is the whole point. Those strings are constants in
 * this app's own data and the test pins them to the converter's output, so nothing
 * author-supplied reaches this call.
 */
export function FormattingReference() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <header className="border-b border-line pb-5">
          <h1 className="font-serif text-xl font-semibold text-ink">Formatting</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
            Royal Road understands no markdown. Its editor has bold, italic, underline
            and strikethrough, and anything else has to arrive as HTML. Write plain
            markdown here and it is translated when you export, so your files stay
            readable in any other editor.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
            The release preview shows the result. Anything on this page that it cannot
            translate is reported there rather than published as stray characters.
          </p>
        </header>

        {FORMATTING_GROUPS.map((group) => (
          <section key={group.id} className="mt-8 border-t border-line pt-6">
            <h2 className="font-serif text-[15px] font-semibold text-ink">{group.title}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{group.summary}</p>
            <dl className="mt-4 space-y-3">
              {group.examples.map((example) => (
                <ExampleRow key={example.source} example={example} />
              ))}
            </dl>
          </section>
        ))}

        <section className="mt-8 border-t border-line pt-6">
          <h2 className="font-serif text-[15px] font-semibold text-ink">
            Markdown that is not translated
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            These reach the published page as the literal characters you typed. The
            release preview names each one it finds, so you will not have to remember
            this table — but it is here for the moment you are mid-sentence.
          </p>

          <div className="mt-4 space-y-3">
            {UNSUPPORTED_CONSTRUCTS.map((construct) => (
              <div
                key={construct.label}
                className="rounded-lg border border-line bg-surface px-4 py-3"
              >
                <div className="flex items-baseline gap-2.5">
                  <Prohibit
                    size={15}
                    weight="bold"
                    aria-hidden="true"
                    className="shrink-0 translate-y-px text-ink-muted"
                  />
                  <code className="font-mono text-[12px] text-ink">{construct.source}</code>
                  <span className="text-[11px] uppercase tracking-wider text-ink-muted">
                    publishes as written
                  </span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
                  {construct.instead}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 border-t border-line pt-6">
          <h2 className="font-serif text-[15px] font-semibold text-ink">Underline</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
            {UNDERLINE_GAP.reason}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
            {UNDERLINE_GAP.instead}
          </p>
        </section>
      </div>
    </div>
  );
}

/**
 * One example: what to type, and what it becomes.
 *
 * Both the rendered result and the raw HTML are shown. The rendered form is what the
 * author needs to recognise; the raw form is what they will paste into Royal Road's
 * source view if they ever need to, so hiding it would only make them guess.
 */
function ExampleRow({ example }: { example: FormattingExample }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <code className="rounded bg-surface-sunken px-2 py-1 font-mono text-[12px] text-accent">
          {example.source}
        </code>
        <ArrowRight size={13} aria-hidden="true" className="shrink-0 text-ink-muted" />
        <span
          className="font-serif text-[14px] text-ink"
          // A constant from this app's data, pinned to the converter's output by
          // tests/unit/formatting-examples.test.ts. See the note at the top.
          dangerouslySetInnerHTML={{ __html: example.html }}
        />
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">{example.note}</p>
      <p className="mt-1 font-mono text-[11px] text-ink-muted/80">{example.html}</p>
    </div>
  );
}