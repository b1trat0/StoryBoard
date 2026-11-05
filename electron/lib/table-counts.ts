/**
 * Row counts used to describe a backup and to verify a restore.
 *
 * Four tables, because they are what the author would notice missing: chapters are
 * the manuscript, entities are the cast, facts are the continuity record, and
 * relations are the web between them. Illustrations and glossary terms are metadata
 * that can be rebuilt from those; prose cannot.
 *
 * Pure by design so the parsing is testable without a database.
 */

export const COUNTED_TABLES = ['chapters', 'entities', 'facts', 'relations'] as const;

export type CountedTable = (typeof COUNTED_TABLES)[number];

export type TableCounts = Record<CountedTable, number>;

/**
 * Builds the single query that returns every count in one round trip.
 *
 * @returns A statement returning one row of pipe-separated integers.
 */
export function countSelectStatement(): string {
  return `SELECT ${COUNTED_TABLES.map((table) => `(SELECT count(*) FROM ${table})`).join(', ')}`;
}

/**
 * Parses psql's unaligned output into counts.
 *
 * @param output - Raw stdout from {@link countSelectStatement}, e.g. `12|0|3|4`.
 * @returns Counts keyed by table.
 * @throws When the output has the wrong shape, because a silent zero would make a
 *   restore look verified when it is not.
 */
export function parseTableCounts(output: string): TableCounts {
  const values = output.trim().split('|');
  if (values.length !== COUNTED_TABLES.length) {
    throw new Error(
      `Expected ${COUNTED_TABLES.length} counts, received ${values.length}: "${output.trim()}"`,
    );
  }

  const counts = {} as TableCounts;
  COUNTED_TABLES.forEach((table, index) => {
    const raw = values[index];
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Count for ${table} is not a non-negative integer: "${raw ?? ''}"`);
    }
    counts[table] = value;
  });

  return counts;
}

/**
 * Renders counts as one line, in a stable order.
 *
 * @param counts - Counts to describe.
 * @returns e.g. `chapters=12 entities=8 facts=40 relations=3`.
 */
export function describeTableCounts(counts: TableCounts): string {
  return COUNTED_TABLES.map((table) => `${table}=${counts[table]}`).join(' ');
}
