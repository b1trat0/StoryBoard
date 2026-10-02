import { WarningCircle } from '@phosphor-icons/react';
import { useCallback, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { getBridge } from './lib/bridge';
import type { Entity, EntityType } from './lib/bridge';
import { SECTIONS } from './lib/sections';
import type { SectionId } from './lib/sections';
import { AppNav } from './components/app-nav';
import { EmptyState } from './components/ui/empty-state';
import { ChapterEditor } from './features/chapters/chapter-editor';
import { OutlineTree } from './features/chapters/outline-tree';
import { useOutline } from './features/chapters/use-outline';
import { EntityCreateDialog } from './features/entities/entity-create-dialog';
import { EntityDetail } from './features/entities/entity-detail';
import { EntityList } from './features/entities/entity-list';
import { EntitySidebar } from './features/entities/entity-sidebar';
import { useEntities } from './features/entities/use-entities';

/**
 * Application shell.
 *
 * Two panes of navigation and one work area. The header chooses the section, the
 * left pane navigates within it, and the middle pane is where the work happens. A
 * section with nothing built yet says so instead of pretending to be empty.
 *
 * The active project is a fixed id for now. The seed creates exactly one, and until
 * there is a way to create another, reading it from configuration is more honest
 * than a project picker that can only ever offer one choice.
 */
const ACTIVE_PROJECT_ID = '00000000-0000-4000-8000-000000000001';

export function App() {
  const {
    byType,
    counts,
    isLoading,
    errorMessage,
    pendingId,
    create,
    update,
    addAlias,
    remove,
  } = useEntities();

  const outline = useOutline(ACTIVE_PROJECT_ID);

  const [activeSection, setActiveSection] = useState<SectionId>('storybook');
  const [activeType, setActiveType] = useState<EntityType>('character');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const entities = byType.get(activeType) ?? [];
  const selected = entities.find((entity) => entity.id === selectedId) ?? null;
  const hasBridge = getBridge() !== null;

  const onSelectType = useCallback((type: EntityType) => {
    setActiveType(type);
    // Selection belongs to a type, so carrying it across tabs would show a place
    // in the character pane.
    setSelectedId(null);
  }, []);

  const onCreate = useCallback(
    async (input: { canonicalName: string; aliases: string[] }) => {
      const created = await create({ type: activeType, ...input });
      toast.success(`${created.canonicalName} added`, {
        description: `Saved to ${activeType}s. Add the details whenever you know them.`,
      });
      setSelectedId(created.id);
    },
    [create, activeType],
  );

  const onSave = useCallback(
    async (
      id: string,
      patch: Partial<
        Pick<Entity, 'summary' | 'appearance' | 'personality' | 'backstory'>
      >,
    ) => {
      await update(id, patch);
      toast.success('Saved');
    },
    [update],
  );

  const onAddAlias = useCallback(
    async (id: string, alias: string) => {
      await addAlias(id, alias);
      toast.success(`Alias added`, { description: `"${alias}" is now a known name.` });
    },
    [addAlias],
  );

  const onDelete = useCallback(
    async (id: string) => {
      await remove(id);
      toast.success('Deleted');
    },
    [remove],
  );

  if (!hasBridge) {
    return <NoBridgeNotice />;
  }

  return (
    <div className="flex h-full flex-col bg-paper">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface pl-4 pr-4">
        <div className="flex items-baseline gap-2.5">
          <span className="font-serif text-[15px] font-semibold tracking-tight text-ink">
            StoryBoard
          </span>
          <span className="text-[13px] text-ink-muted">My Serial</span>
        </div>
        <AppNav activeSection={activeSection} onSelectSection={setActiveSection} />
        <span className="text-[11px] text-ink-muted">
          Local only. Nothing leaves this machine.
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {activeSection === 'storybook' && (
          <EntitySidebar
            activeType={activeType}
            counts={counts}
            onSelectType={onSelectType}
          />
        )}

        {activeSection === 'chapters' && (
          <nav
            aria-label="Outline"
            className="flex w-72 shrink-0 flex-col border-r border-line bg-surface-sunken/40"
          >
            <OutlineTree
              outline={outline}
              selectedChapterId={outline.chapter?.id ?? null}
              onSelectChapter={(id) => void outline.openChapter(id)}
            />
          </nav>
        )}

        <div className="flex min-w-0 flex-1">
          {errorMessage !== null && (
            <div
              role="alert"
              className="flex items-start gap-3 border-b border-danger/25 bg-danger-soft px-6 py-3"
            >
              <WarningCircle
                size={17}
                weight="bold"
                aria-hidden="true"
                className="mt-px shrink-0 text-danger"
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-danger">
                  Could not load your story
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-danger/90">
                  {errorMessage}
                </p>
              </div>
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            {activeSection === 'storybook' && (
              <EntityList
                entities={entities}
                type={activeType}
                isLoading={isLoading}
                selectedId={selectedId}
                onSelect={(entity) => setSelectedId(entity.id)}
                onCreate={() => setIsCreateOpen(true)}
                canCreate={!isLoading}
              />
            )}

            {activeSection === 'chapters' && (
              <ChapterEditor
                key={outline.chapter?.id ?? 'none'}
                chapter={outline.chapter}
                isLoading={outline.isChapterLoading}
                onSaveOutline={outline.saveChapterOutline}
              />
            )}

            {!isBuiltSection(activeSection) && (
              <div className="flex flex-1 items-center justify-center p-8">
                <div className="w-full max-w-sm">
                  <EmptyState
                    title={`${sectionTitle(activeSection)} is not built yet`}
                    body="The data behind this screen is already in the database. The screen is not."
                  />
                </div>
              </div>
            )}
          </div>

          {/*
            Only the Storybook section has a third pane. Chapters use the editor as
            their work area, so a transient detail panel beside it would crowd the
            prose for no gain.
          */}
          {activeSection === 'storybook' && (
            <EntityDetail
              key={selectedId ?? 'none'}
              entity={selected}
              isPending={pendingId === selectedId}
              onClose={() => setSelectedId(null)}
              onSave={onSave}
              onAddAlias={onAddAlias}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>

      {isCreateOpen && (
        <EntityCreateDialog
          type={activeType}
          onClose={() => setIsCreateOpen(false)}
          onSubmit={onCreate}
        />
      )}

      <Toaster
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast:
              '!rounded-lg !border-line !bg-surface !text-ink !shadow-[0_8px_24px_-8px_rgb(27_27_25/0.18)]',
            description: '!text-ink-muted',
            actionButton: '!bg-accent !text-white',
          },
        }}
      />
    </div>
  );
}

/** True once a section has a real screen behind it. */
function isBuiltSection(id: SectionId): boolean {
  return SECTIONS.find((section) => section.id === id)?.isBuilt === true;
}

function sectionTitle(id: SectionId): string {
  return SECTIONS.find((section) => section.id === id)?.label ?? id;
}

/**
 * Shown when the renderer is running outside Electron.
 *
 * Reaching this screen means `npm run dev:vite` was opened in a browser, or the
 * preload failed to attach. It names both commands instead of showing an error
 * about a missing property, because the underlying cause is never the data.
 */
function NoBridgeNotice() {
  return (
    <div className="flex h-full items-center justify-center bg-paper p-8">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-7">
        <h1 className="font-serif text-xl font-semibold text-ink">
          Start StoryBoard from the terminal
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          This page is the renderer on its own. It reaches the database through
          the Electron preload bridge, and a plain browser has no such bridge.
        </p>
        <div className="mt-5 space-y-3">
          <div>
            <p className="text-[13px] font-medium text-ink">For writing, with reloads</p>
            <pre className="mt-1.5 rounded-md border border-line bg-surface-sunken px-3 py-2 font-mono text-[13px] text-accent">
              npm run dev
            </pre>
          </div>
          <div>
            <p className="text-[13px] font-medium text-ink">For the built app</p>
            <pre className="mt-1.5 rounded-md border border-line bg-surface-sunken px-3 py-2 font-mono text-[13px] text-accent">
              npm start
            </pre>
          </div>
        </div>
        <p className="mt-5 text-[13px] text-ink-muted">
          If the app is already open, the database probably is not. Check it with{' '}
          <span className="font-mono">npm run db:up</span>.
        </p>
      </div>
    </div>
  );
}
