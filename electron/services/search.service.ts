import type { SearchRepository, SearchResult } from '../repositories/search.repository.js';

/**
 * Search rules.
 *
 * Two characters minimum: one letter matches half the cast and produces a list that is
 * slower to read than scrolling. The query is trimmed so a trailing space does not
 * silently change results.
 */

export interface SearchService {
  search(input: { projectId: string; query: string }): Promise<SearchResult[]>;
}

const MIN_QUERY_LENGTH = 2;

export function createSearchService(repository: SearchRepository): SearchService {
  return {
    async search(input) {
      const query = input.query.trim();
      if (query.length < MIN_QUERY_LENGTH) {
        return [];
      }
      return repository.search(input.projectId, query);
    },
  };
}
