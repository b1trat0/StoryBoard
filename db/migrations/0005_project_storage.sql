-- 0005_project_storage.sql
--
-- Lets each work keep its files where the author wants them.
--
-- Until now every durable directory was global: one folder for dumps, one for
-- illustrations, one for exports. That is wrong the moment there is more than one
-- work — three novels' files in one folder is exactly the mess the project layer was
-- meant to remove.
--
-- storage_root is an absolute directory chosen when the work is created. An empty
-- string means "not chosen", in which case the app falls back to its configured
-- default rather than inventing a path inside the repository.
--
-- The database itself is still one database: this column decides where files land,
-- not where rows live. Backups stay whole-database because a dump of one work would
-- lose the shared project rows and complicate restore for no real gain.
--
-- Migrations are forward-only. 0001-0004 are untouched.

ALTER TABLE projects
  ADD COLUMN storage_root text NOT NULL DEFAULT '';

COMMENT ON COLUMN projects.storage_root IS
  'Absolute folder for this work''s files: default export location, illustration folder, archive. Empty means use the app default.';
