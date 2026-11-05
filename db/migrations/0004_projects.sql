-- 0004_projects.sql
--
-- Turns "one hardcoded project" into "works you can have more than one of".
--
-- The projects table already existed because every chapter, entity and fact hangs off
-- it. What was missing was any way to name a second one. Two columns carry the
-- difference between works:
--
--   kind             what you are writing: a light novel (episodic, illustrated) or a
--                    plain novel. It is not decorative: export defaults and future
--                    checks read it.
--   export_profile   which publishing rules apply. royal_road enables the length and
--                    publishability warnings that Royal Road enforces; plain skips
--                    them, because a normal manuscript is not too short for a web
--                    serial and should not be told that it is.
--
-- archived_at rather than DELETE: a work holds hundreds of chapters and thousands of
-- facts, and deleting it cascades all of them away. Archiving is reversible; deletion
-- of a manuscript is not, and this app does not offer irreversible actions for data
-- that exists nowhere else.
--
-- Migrations are forward-only. 0001-0003 are left untouched.

CREATE TYPE project_kind AS ENUM ('light_novel', 'novel');
CREATE TYPE export_profile AS ENUM ('royal_road', 'plain');

ALTER TABLE projects
  ADD COLUMN kind           project_kind   NOT NULL DEFAULT 'light_novel',
  ADD COLUMN export_profile export_profile NOT NULL DEFAULT 'royal_road',
  ADD COLUMN summary        text           NOT NULL DEFAULT '',
  ADD COLUMN archived_at    timestamptz,
  ADD COLUMN updated_at     timestamptz    NOT NULL DEFAULT now();

-- Two works with the same title is not a data error, but it makes the switcher
-- unusable: the author would be choosing between two identical labels. Case-folding
-- matches how the entity name index behaves.
CREATE UNIQUE INDEX projects_title_uq ON projects (lower(title));

-- The switcher only lists unarchived works, which is almost every query.
CREATE INDEX projects_unarchived_idx ON projects (created_at) WHERE archived_at IS NULL;

COMMENT ON COLUMN projects.kind IS
  'What is being written. light_novel or novel; drives export assumptions, never prose.';
COMMENT ON COLUMN projects.export_profile IS
  'Which publishing rules apply. royal_road enables Royal Road length checks; plain disables them.';
COMMENT ON COLUMN projects.archived_at IS
  'Set when the author hides a work. Never a delete: chapters, entities and facts cascade.';
