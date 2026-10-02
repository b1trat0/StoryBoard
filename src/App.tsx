import { WarningCircle } from '@phosphor-icons/react';
import { useCallback, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { getBridge } from './lib/bridge';
import type { Entity, EntityType } from './lib/bridge';
import { EntityCreateDialog } from './features/entities/entity-create-dialog';
import { EntityDetail } from './features/entities/entity-detail';
import { EntityList } from './features/entities/entity-list';
import { EntitySidebar } from './features/entities/entity-sidebar';
import { useEntities } from './features/entities/use-entities';

/**
 * Application shell.
 *
 * Three panes: types on the left, the list in the middle, the selected entry on
 * the right. The detail pane only appears when something is selected, so the
 * list gets the full width until it does.
 *
 * Every screen in this app will follow this shape: something always occupies the
 * left pane, the middle pane is the work area, and side panels are transient.
 */
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
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface px-4">
        <div className="flex items-baseline gap-2.5">
          <span className="font-serif text-[15px] font-semibold tracking-tight text-ink">
            StoryBoard
          </span>
          <span className="text-[13px] text-ink-muted">My Serial</span>
        </div>
        <span className="text-[11px] text-ink-muted">
          Local only. Nothing leaves this machine.
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <EntitySidebar
          activeType={activeType}
          counts={counts}
          onSelectType={onSelectType}
        />

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
            <EntityList
              entities={entities}
              type={activeType}
              isLoading={isLoading}
              selectedId={selectedId}
              onSelect={(entity) => setSelectedId(entity.id)}
              onCreate={() => setIsCreateOpen(true)}
              canCreate={!isLoading}
            />
          </div>

          {/*
            Keyed on the selected id: switching entries remounts the panel, which
            is what seeds its draft from the new entity. Without the key the panel
            would keep showing, and editing, the previously selected entry.
          */}
          <EntityDetail
            key={selectedId ?? 'none'}
            entity={selected}
            isPending={pendingId === selectedId}
            onClose={() => setSelectedId(null)}
            onSave={onSave}
            onAddAlias={onAddAlias}
            onDelete={onDelete}
          />
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
