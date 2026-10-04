-- 0003_chapter_author_notes.sql
--
-- Adds the two author-note fields Royal Road's chapter editor has and StoryBoard
-- did not store.
--
-- Royal Road's chapter form is Title, Author Notes, Chapter Content. The notes
-- are two separate boxes, not one: a pre-chapter note sits above the prose and a
-- post-chapter note sits below it. Verified on royalroad.com forums that they are
-- genuinely distinct fields, and the community consensus is to keep promotional
-- links in the post box so a reader reaches the chapter before the ask.
--
-- Why store them at all rather than leaving them to the browser form: these are
-- the most repeated piece of per-chapter boilerplate in serial publishing
-- ("start at book one", release schedule, Discord links). StoryBoard exists so
-- the author does not retype them by hand for two hundred chapters.
--
-- Shape follows the existing prose columns: NOT NULL DEFAULT '' so no nullable
-- branch reaches the renderer or the contract, and so an empty note is
-- indistinguishable from one that was never written.
--
-- Deliberately NOT NULL with a default rather than nullable: there is no third
-- state worth modelling, and the editor would otherwise need null handling on a
-- field that is almost always empty.
--
-- Migrations are forward-only. 0001_init.sql is left untouched.

alter table chapters
  add column author_note_pre text NOT NULL DEFAULT '',
  add column author_note_post text NOT NULL DEFAULT '';

comment on column chapters.author_note_pre is
  'Royal Road pre-chapter author note. Rendered above the prose. Excluded from RSS and feed exports by Royal Road.';
comment on column chapters.author_note_post is
  'Royal Road post-chapter author note. Rendered below the prose. Excluded from RSS and feed exports by Royal Road.';

-- Backfill note: no UPDATE is needed. The DEFAULT applies to every existing row,
-- and there is nothing to migrate because no chapter stored notes before this.