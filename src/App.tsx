import { WarningCircle, HardDrives } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { getBridge } from './lib/bridge';
import type { Entity, EntityType } from './lib/bridge';
import { SECTIONS } from './lib/sections';
import type { SectionId } from './lib/sections';
import { AppNav } from './components/app-nav';
import { EmptyState } from './components/ui/empty-state';
import { ChapterEditor } from './features/chapters/chapter-editor';
import { DiscardDraftDialog } from './features/chapters/discard-draft-dialog';
import { OutlineTree } from './features/chapters/outline-tree';
import { useChapterDraft } from './features/chapters/use-chapter-draft';
import { useCrashDraft } from './features/chapters/use-crash-draft';
import { useOutline } from './features/chapters/use-outline';
import { EntityCreateDialog } from './features/entities/entity-create-dialog';
import { EntityDetail } from './features/entities/entity-detail';
import { EntityList } from './features/entities/entity-list';
import { EntitySidebar } from './features/entities/entity-sidebar';
import { useEntities } from './features/entities/use-entities';
import { FormattingReference } from './features/export/formatting-reference';
import { BackupDialog } from './features/backup/backup-dialog';
import { ProjectCreateDialog } from './features/projects/project-create-dialog';
import { ProjectSwitcher } from './features/projects/project-switcher';
import { useProjects } from './features/projects/use-projects';
import { RelationsScreen } from './features/relations/relations-screen';
import { GlossaryScreen } from './features/glossary/glossary-screen';
import { IllustrationsPanel } from './features/illustrations/illustrations-panel';
import { countParagraphs } from './lib/chapter-text';
import { Button } from './components/ui/button';
import { ReleasePreview } from './features/export/release-preview';
import { VolumeDocxExport } from './features/export/volume-docx-export';
import { ProjectArchive } from './features/export/project-archive';
import { SearchDialog } from './features/search/search-dialog';
import type { SearchResult } from './lib/bridge';

/**
 * Application shell.
 *
 * Two panes of navigation and one work area. The header chooses the section and the
 * work, the left pane navigates within it, and the middle pane is where the work
 * happens. A section with nothing built yet says so instead of pretending to be empty.
 *
 * The open work is not a constant any more. Which one was last used lives in the main
 * process's settings file, because the renderer owns no durable state.
 */
export function App() {
  const projects = useProjects();
  const activeProjectId = projects.activeProject?.id ?? null;

  const {
    entities: allEntities,
    byType,
    counts,
    isLoading,
    errorMessage,
    pendingId,
    create,
    update,
    addAlias,
    remove,
  } = useEntities(activeProjectId);

  const outline = useOutline(activeProjectId);
  // Called here, above the section switch, rather than inside the editor. The editor
  // unmounts whenever another section is showing, and a buffer held inside it would go
  // with it, so looking at another section would silently drop unsaved prose.
  const draft = useChapterDraft(outline.chapter, outline.saveChapterOutline);
  // Crash recovery mirrors the buffer to disk while it is dirty and offers a stored
  // copy back. It never writes to the database and never restores without a click.
  const crashDraft = useCrashDraft(draft.draft, draft.isProseDirty, draft.updateDraft);
  // Pulled out of the two hook results so the callbacks below depend on the members
  // rather than on an object that is rebuilt on every render.
  const { isProseDirty } = draft;
  const { openChapter, selectChapter, selectedChapterId } = outline;
  const { commitProse } = draft;

  /*
   * Tell main whether anything is unsaved.
   *
   * The window's close button is handled by the main process, which cannot see the
   * draft buffer. This is the only thing that lets it warn instead of discarding.
   */
  useEffect(() => {
    const bridge = getBridge();
    if (bridge === null) {
      return;
    }
    void bridge.editorSafety.setDirty({ isDirty: isProseDirty });
  }, [isProseDirty]);

  /*
   * "Save and quit" chosen in the native close prompt.
   *
   * The window is only allowed to close after the write came back successful. A failed
   * save leaves the app open with the error visible, which is the only outcome that
   * cannot lose prose.
   */
  useEffect(() => {
    const bridge = getBridge();
    if (bridge === null) {
      return;
    }
    return bridge.editorSafety.onSaveAndQuit(() => {
      void (async () => {
        const isSaved = await commitProse();
        if (isSaved) {
          await bridge.editorSafety.confirmQuit({});
          return;
        }
        toast.error('Could not save before quitting', {
          description: 'The window stayed open. Check the error shown in the editor.',
        });
      })();
    });
  }, [commitProse]);

  const [activeSection, setActiveSection] = useState<SectionId>('storybook');
  const [activeType, setActiveType] = useState<EntityType>('character');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [pendingChapterId, setPendingChapterId] = useState<string | null>(null);
  const [isWorkDialogOpen, setIsWorkDialogOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Ctrl+K from anywhere. Registered before the early returns below so the shortcut
  // exists on the first-run screen too, where there is simply nothing to search yet.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const entities = byType.get(activeType) ?? [];
  const selected = entities.find((entity) => entity.id === selectedId) ?? null;
  const hasBridge = getBridge() !== null;

  /**
   * Chapters as flat options, for the pickers that name a source chapter.
   *
   * Facts require a source chapter and relations can be valid over a chapter range, so
   * both screens need the outline in reading order rather than as a tree.
   */
  const chapterOptions = useMemo(
    () =>
      outline.tree.volumes.flatMap((volume) =>
        volume.arcs.flatMap((arc) =>
          arc.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title })),
        ),
      ),
    [outline.tree],
  );

  const onSelectProject = useCallback(
    (projectId: string) => {
      if (projectId === activeProjectId) {
        return;
      }
      // Switching works replaces the cast, the outline and the editor buffer. Unsaved
      // prose is the one thing that cannot be recovered from the other work, so the
      // switch is refused rather than prompted: a save is one keystroke away.
      if (isProseDirty) {
        toast.error('Save your prose before switching works', {
          description: 'Press Ctrl+S, then choose the other work.',
        });
        return;
      }
      void projects.selectProject(projectId).catch((err: unknown) => {
        toast.error('Could not switch works', {
          description: err instanceof Error ? err.message : undefined,
        });
      });
      setSelectedId(null);
      setPendingChapterId(null);
    },
    [activeProjectId, isProseDirty, projects],
  );

  const onCreateProject = useCallback(
    async (input: {
      title: string;
      kind: 'light_novel' | 'novel';
      exportProfile: 'royal_road' | 'plain';
    }) => {
      const created = await projects.createProject(input);
      setSelectedId(null);
      setPendingChapterId(null);
      toast.success(`${created.title} created`, {
        description: 'Add volumes and chapters to start the outline.',
      });
    },
    [projects],
  );

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

  /**
   * Selecting a chapter from the outline tree.
   *
   * Switching chapters is the one navigation that genuinely destroys the buffer, so it
   * asks before doing it. Moving between sections does not need a prompt any more: the
   * buffer lives above the section switch and survives the trip.
   */
  const onSelectChapter = useCallback(
    (chapterId: string) => {
      if (activeSection === 'export') {
        // The preview reads the committed chapter itself, so selecting must not pull
        // the editor's copy of the prose into memory.
        selectChapter(chapterId);
        return;
      }
      if (isProseDirty && chapterId !== selectedChapterId) {
        setPendingChapterId(chapterId);
        return;
      }
      void openChapter(chapterId);
    },
    [activeSection, isProseDirty, openChapter, selectChapter, selectedChapterId],
  );

  const onDiscardAndSwitch = useCallback(() => {
    const target = pendingChapterId;
    setPendingChapterId(null);
    if (target !== null) {
      void openChapter(target);
    }
  }, [openChapter, pendingChapterId]);

  const onCancelSwitch = useCallback(() => setPendingChapterId(null), []);

  /**
   * Jumping to a search result.
   *
   * A fact goes to the chapter it came from, an entity to its storybook tab, and a
   * glossary term to the glossary. The point of recall is arriving where the thing
   * lives, not reading a list of where it might be.
   */
  const onSelectSearchResult = useCallback(
    (result: SearchResult) => {
      setIsSearchOpen(false);
      if (result.kind === 'entity') {
        setActiveSection('storybook');
        setActiveType(result.entityType ?? 'character');
        setSelectedId(result.id);
        return;
      }
      if (result.kind === 'glossary') {
        setActiveSection('glossary');
        return;
      }
      setActiveSection('chapters');
      if (result.chapterId !== null) {
        setPendingChapterId(null);
        void openChapter(result.chapterId);
      }
    },
    [openChapter],
  );

  if (!hasBridge) {
    return <NoBridgeNotice />;
  }

  /*
   * A fresh database has no work yet. Showing an empty three-pane shell would look
   * like the app failed to load; asking for a title is the only useful first screen.
   */
  if (!projects.isLoading && projects.activeProject === null) {
    return (
      <div className="flex h-full items-center justify-center bg-paper p-8">
        <div className="w-full max-w-md rounded-xl border border-line bg-surface p-7">
          <h1 className="font-serif text-xl font-semibold text-ink">
            Create your first work
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            A work is one manuscript with its own cast, outline and continuity record.
            You can have as many as you write.
          </p>
          {projects.errorMessage !== null && (
            <p role="alert" className="mt-3 text-[12.5px] text-danger">
              {projects.errorMessage}
            </p>
          )}
          <Button className="mt-5" onClick={() => setIsWorkDialogOpen(true)}>
            New work
          </Button>
        </div>
        {isWorkDialogOpen && (
          <ProjectCreateDialog
            isOpen
            onClose={() => setIsWorkDialogOpen(false)}
            onSubmit={onCreateProject}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-paper">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface pl-4 pr-4">
        <div className="flex items-baseline gap-2.5">
          <span className="font-serif text-[15px] font-semibold tracking-tight text-ink">
            StoryBoard
          </span>
          <ProjectSwitcher
            projects={projects.projects}
            activeProjectId={activeProjectId}
            isLoading={projects.isLoading}
            isDisabled={isProseDirty}
            onSelect={onSelectProject}
            onCreate={() => setIsWorkDialogOpen(true)}
          />
        </div>
        <AppNav activeSection={activeSection} onSelectSection={setActiveSection} />
        <div className="flex items-center gap-3">
          {/*
            Backups sit in the header rather than a settings screen: it is the one
            action that protects everything else, and it should be reachable from any
            section without hunting.
          */}
          <Button variant="ghost" size="sm" onClick={() => setIsBackupOpen(true)}>
            <HardDrives size={15} weight="bold" aria-hidden="true" />
            Backup
          </Button>
          <span className="text-[11px] text-ink-muted">
            Local only. Nothing leaves this machine.
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {activeSection === 'storybook' && (
          <EntitySidebar
            activeType={activeType}
            counts={counts}
            onSelectType={onSelectType}
          />
        )}

        {(activeSection === 'chapters' ||
          activeSection === 'export' ||
          activeSection === 'illustrations') && (
          <nav
            aria-label="Outline"
            className="flex w-72 shrink-0 flex-col border-r border-line bg-surface-sunken/40"
          >
<OutlineTree
                outline={outline}
                selectedChapterId={outline.selectedChapterId}
                onSelectChapter={onSelectChapter}
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
                draft={draft.draft}
                isLoading={outline.isChapterLoading}
                isDirty={draft.isProseDirty}
                savedTitle={draft.savedTitle}
                isSavingProse={draft.isSavingProse}
                errorMessage={draft.errorMessage}
                updateDraft={draft.updateDraft}
                saveOutlineField={draft.saveOutlineField}
                commitProse={draft.commitProse}
                recoveredDraft={crashDraft.recovered}
                onRestoreDraft={crashDraft.restore}
                onDiscardDraft={crashDraft.discard}
                projectId={activeProjectId}
                chapters={chapterOptions}
                povOptions={allEntities
                  .filter((entity) => entity.type === 'character')
                  .map((entity) => ({ id: entity.id, label: entity.canonicalName }))}
                onMoveChapter={(direction) => {
                  const chapterId = draft.draft?.id;
                  return chapterId === undefined
                    ? Promise.resolve()
                    : outline.moveChapter(chapterId, direction);
                }}
              />
            )}

            {activeSection === 'formatting' && <FormattingReference />}

            {activeSection === 'relations' && (
              <RelationsScreen
                projectId={activeProjectId}
                entities={allEntities}
                chapters={chapterOptions}
              />
            )}

            {activeSection === 'glossary' && (
              <GlossaryScreen projectId={activeProjectId} />
            )}

            {activeSection === 'illustrations' && (
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="mx-auto w-full max-w-3xl space-y-4">
                  <div>
                    <h1 className="font-serif text-[15px] font-semibold text-ink">
                      Illustrations
                    </h1>
                    <p className="mt-0.5 text-[12.5px] text-ink-muted">
                      Images for the chapter you have open. Pick a chapter in the outline
                      to see or add its images.
                    </p>
                  </div>
                  {outline.chapter === null ? (
                    <EmptyState
                      title="No chapter open"
                      body="Choose a chapter in the outline. Images are anchored to a paragraph inside one chapter, so they belong to the chapter rather than the work."
                    />
                  ) : (
                    <IllustrationsPanel
                      chapterId={outline.chapter.id}
                      paragraphCount={countParagraphs(outline.chapter.bodyMd)}
                    />
                  )}
                </div>
              </div>
            )}

            {activeSection === 'export' && (
              <div className="flex min-h-0 flex-1 flex-col">
                {/*
                  The export panel sits above the chapter preview rather than replacing
                  it. The preview answers "will this chapter publish right" and the
                  volume export answers "what do I hand to Royal Road"; both are needed
                  before publishing and neither replaces the other.
                */}
                <VolumeDocxExport
                  volumes={outline.tree.volumes}
                  isLoading={outline.isLoading}
                />
                <ProjectArchive projectId={activeProjectId} />
                <ReleasePreview
                  key={outline.selectedChapterId ?? 'none'}
                  chapterId={outline.selectedChapterId}
                  isOutlineLoading={outline.isLoading}
                />
              </div>
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
              projectId={activeProjectId}
              chapters={chapterOptions}
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

      {/*
        Only offered when a chapter switch is genuinely pending. Rendering it
        unconditionally would put a modal in the DOM that is not about anything.
      */}
      {pendingChapterId !== null && draft.draft !== null && (
        <DiscardDraftDialog
          isOpen
          chapterTitle={draft.draft.title}
          onCancel={onCancelSwitch}
          onDiscard={onDiscardAndSwitch}
        />
      )}

      {isBackupOpen && (
        <BackupDialog isOpen onClose={() => setIsBackupOpen(false)} />
      )}

      {isWorkDialogOpen && (
        <ProjectCreateDialog
          isOpen
          onClose={() => setIsWorkDialogOpen(false)}
          onSubmit={onCreateProject}
        />
      )}

      <SearchDialog
        isOpen={isSearchOpen}
        projectId={activeProjectId}
        onClose={() => setIsSearchOpen(false)}
        onSelect={onSelectSearchResult}
      />

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
