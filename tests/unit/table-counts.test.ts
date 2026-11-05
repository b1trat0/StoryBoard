import { describe, expect, it } from 'vitest';
import {
  COUNTED_TABLES,
  countSelectStatement,
  describeTableCounts,
  parseTableCounts,
} from '../../electron/lib/table-counts.js';

/**
 * Row-count parsing.
 *
 * A backup's counts are part of what the author is shown, and a restore drill is
 * judged by comparing two sets of them. A parser that quietly turns a broken query
 * into zeros would make a failed backup look empty but successful, so the failure
 * cases matter more than the happy one.
 */

describe('parsing psql counts', () => {
  it('reads one count per table, in order', () => {
    expect(parseTableCounts('12|8|40|3')).toEqual({
      chapters: 12,
      entities: 8,
      facts: 40,
      relations: 3,
    });
  });

  it('tolerates surrounding whitespace and a trailing newline', () => {
    expect(parseTableCounts('  0|0|0|0\n')).toEqual({
      chapters: 0,
      entities: 0,
      facts: 0,
      relations: 0,
    });
  });

  it('throws when a count is missing rather than reporting zero', () => {
    expect(() => parseTableCounts('12|8|40')).toThrow(/Expected 4 counts/);
  });

  it('throws when a value is not a number', () => {
    expect(() => parseTableCounts('12|x|40|3')).toThrow(/not a non-negative integer/);
  });

  it('throws on a negative count', () => {
    expect(() => parseTableCounts('12|-1|40|3')).toThrow(/not a non-negative integer/);
  });

  it('throws on an empty result', () => {
    expect(() => parseTableCounts('')).toThrow();
  });
});

describe('count query', () => {
  it('counts exactly the tables the contract reports', () => {
    const statement = countSelectStatement();
    for (const table of COUNTED_TABLES) {
      expect(statement).toContain(`(SELECT count(*) FROM ${table})`);
    }
  });
});

describe('describing counts', () => {
  it('renders one stable line for logs', () => {
    expect(
      describeTableCounts({ chapters: 12, entities: 8, facts: 40, relations: 3 }),
    ).toBe('chapters=12 entities=8 facts=40 relations=3');
  });
});
