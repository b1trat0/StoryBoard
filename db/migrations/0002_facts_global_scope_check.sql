-- 0002_facts_global_scope_check.sql
--
-- Fixes a constraint in 0001_init.sql that never did anything.
--
-- The original CHECK was:
--
--   check (
--     scope_type = 'global'
--     or scope_id is not null
--     or scope_type <> 'global'
--   )
--
-- Which is a tautology. Every row satisfies it: a global row satisfies the
-- first arm, a scoped row satisfies the second, and the third arm is true for
-- every scoped row. Postgres accepted a global fact carrying a scope_id, which
-- is exactly the shape the constraint was written to forbid.
--
-- The correct rule is two one-way implications, not one disjunction:
--
--   * a non-global fact must carry a scope_id  (0001 already had this, keep it)
--   * a global fact must NOT carry a scope_id (this is what was missing)
--
-- Migrations are forward-only, so this corrects the constraint by replacing it
-- rather than editing 0001, which has already been applied.

alter table facts
  drop constraint if exists facts_global_rows_have_no_scope_id;

alter table facts
  add constraint facts_global_rows_have_no_scope_id
  check (scope_type <> 'global' or scope_id is null);

-- Backfill note: no UPDATE is needed. If 0001's tautology ever admitted a
-- malformed global row, this ADD CONSTRAINT would fail. That failure is
-- intentional and correct: it means real data violated the invariant, and a
-- silent repair would discard the evidence. The author decides how to resolve it.