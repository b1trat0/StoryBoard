import { useCallback, useEffect, useMemo, useState } from 'react';
import { describeError, getBridge } from '../../lib/bridge';
import type { Entity, EntityType } from '../../lib/bridge';

/**
 * The types an entity can have, in the order the sidebar shows them.
 */
export const ENTITY_TYPES: { value: EntityType; label: string; plural: string }[] = [
  { value: 'character', label: 'Character', plural: 'Characters' },
  { value: 'place', label: 'Place', plural: 'Places' },
  { value: 'faction', label: 'Faction', plural: 'Factions' },
  { value: 'item', label: 'Item', plural: 'Items' },
  { value: 'rule', label: 'Rule', plural: 'Rules' },
];

/**
 * Every entity in the project, plus the operations that change them.
 *
 * The whole table is fetched once rather than per tab, because the sidebar needs
 * a count for every type at the same time the list needs its own rows. Five
 * filtered queries would be five round trips to render one number per tab.
 *
 * No LIMIT and no pagination: the project rules forbid assuming a maximum, and a
 * truncated list here would quietly hide a character from a continuity check.
 */
/**
 * Every entity in the active work, plus the operations that change them.
 *
 * The work is a parameter rather than a constant: switching works has to change what
 * this lists, and a module-level id would keep showing the previous manuscript's cast
 * until the app restarted.
 *
 * No LIMIT and no pagination: the project rules forbid assuming a maximum, and a
 * truncated list here would quietly hide a character from a continuity check.
 */
export function useEntities(projectId: string | null) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const bridge = getBridge();
    if (bridge === null) {
      return;
    }
    if (projectId === null) {
      setEntities([]);
      setIsLoading(false);
      return;
    }

    try {
      const rows = await bridge.entities.list({ projectId });
      setEntities(rows);
      setErrorMessage(null);
    } catch (err) {
      // The service returns a sentence naming the fix, so it is shown verbatim
      // rather than replaced with something vaguer.
      setErrorMessage(describeError(err));
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // Fetching from the main process is the legitimate reason for an effect here.
    // Every setState runs after an await, so nothing cascades synchronously; the
    // lint rule cannot see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const byType = useMemo(() => {
    const grouped = new Map<EntityType, Entity[]>();
    for (const option of ENTITY_TYPES) {
      grouped.set(option.value, []);
    }
    for (const entity of entities) {
      grouped.get(entity.type)?.push(entity);
    }
    return grouped;
  }, [entities]);

  const counts = useMemo(() => {
    const result = {} as Record<EntityType, number>;
    for (const option of ENTITY_TYPES) {
      result[option.value] = byType.get(option.value)?.length ?? 0;
    }
    return result;
  }, [byType]);

  const create = useCallback(
    async (input: {
      type: EntityType;
      canonicalName: string;
      aliases: string[];
    }): Promise<Entity> => {
      const bridge = getBridge();
      if (bridge === null) {
        throw new Error('Not running inside the StoryBoard app');
      }
      if (projectId === null) {
        throw new Error('Open a work before adding an entity.');
      }
      const created = await bridge.entities.create({
        projectId,
        type: input.type,
        canonicalName: input.canonicalName,
        aliases: input.aliases,
        summary: '',
        originEntityId: null,
      });
      await reload();
      return created;
    },
    [reload, projectId],
  );

  const update = useCallback(
    async (
      id: string,
      patch: Partial<
        Pick<Entity, 'summary' | 'appearance' | 'personality' | 'backstory'>
      >,
    ): Promise<Entity> => {
      const bridge = getBridge();
      if (bridge === null) {
        throw new Error('Not running inside the StoryBoard app');
      }
      setPendingId(id);
      try {
        const updated = await bridge.entities.update({ id, ...patch });
        // Applied locally rather than refetching: the returned row is the truth,
        // and a full reload after every keystroke-driven save would make the
        // detail panel flash.
        setEntities((current) =>
          current.map((entity) => (entity.id === id ? updated : entity)),
        );
        return updated;
      } finally {
        setPendingId(null);
      }
    },
    [],
  );

  const addAlias = useCallback(async (id: string, alias: string): Promise<Entity> => {
    const bridge = getBridge();
    if (bridge === null) {
      throw new Error('Not running inside the StoryBoard app');
    }
    setPendingId(id);
    try {
      const updated = await bridge.entities.addAlias({ id, alias });
      setEntities((current) =>
        current.map((entity) => (entity.id === id ? updated : entity)),
      );
      return updated;
    } finally {
      setPendingId(null);
    }
  }, []);

  const remove = useCallback(async (id: string): Promise<void> => {
    const bridge = getBridge();
    if (bridge === null) {
      throw new Error('Not running inside the StoryBoard app');
    }
    setPendingId(id);
    try {
      await bridge.entities.remove({ id });
      setEntities((current) => current.filter((entity) => entity.id !== id));
    } finally {
      setPendingId(null);
    }
  }, []);

  return {
    entities,
    byType,
    counts,
    total: entities.length,
    isLoading,
    errorMessage,
    pendingId,
    reload,
    create,
    update,
    addAlias,
    remove,
  };
}
