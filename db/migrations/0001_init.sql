-- 0001_init.sql
-- StoryBoard initial schema.
--
-- Design rules enforced here, not in application code:
--   * every fact carries a source chapter and a source quote
--   * every primary key is a database-generated uuid
--   * relations keep category-specific columns null instead of using one wide shape
--   * nothing assumes a maximum count of chapters, volumes, entities or facts

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enum types are named, not free text, so a typo cannot become a new category.
-- Migrations are forward-only: to change a category, add a new migration that
-- rewrites existing rows before altering the type.

CREATE TYPE entity_type AS ENUM ('character', 'place', 'faction', 'item', 'rule');

CREATE TYPE ability_kind AS ENUM ('power', 'technique');

CREATE TYPE relation_category AS ENUM ('social', 'possession', 'membership');

CREATE TYPE chapter_type AS ENUM ('chapter', 'prologue', 'epilogue', 'interlude');

CREATE TYPE chapter_status AS ENUM ('outline', 'draft', 'done');

CREATE TYPE fact_scope_type AS ENUM ('chapter', 'entity', 'relation', 'global');

CREATE TYPE fact_kind AS ENUM (
  'event',
  'character_fact',
  'new_entity',
  'relation_shift',
  'open_promise',
  'unresolved'
);

CREATE TYPE fact_status AS ENUM ('draft', 'approved', 'rejected');

CREATE TYPE glossary_kind AS ENUM ('name', 'term', 'honorific', 'style');

CREATE TYPE illustration_provider AS ENUM ('catbox', 'imgbb', 'manual');

CREATE TABLE projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL CHECK (length(trim(title)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE volumes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (length(trim(title)) > 0),
  ordinal     integer NOT NULL CHECK (ordinal >= 0),
  summary     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX volumes_project_ordinal_uq ON volumes (project_id, ordinal);

CREATE TABLE arcs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  volume_id   uuid NOT NULL REFERENCES volumes (id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (length(trim(title)) > 0),
  ordinal     integer NOT NULL CHECK (ordinal >= 0),
  summary     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX arcs_volume_ordinal_uq ON arcs (volume_id, ordinal);

CREATE TABLE entities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  type              entity_type NOT NULL,
  canonical_name    text NOT NULL CHECK (length(trim(canonical_name)) > 0),
  aliases           text[] NOT NULL DEFAULT '{}',
  summary           text NOT NULL DEFAULT '',
  appearance        text NOT NULL DEFAULT '',
  personality       text NOT NULL DEFAULT '',
  backstory         text NOT NULL DEFAULT '',
  origin_entity_id  uuid REFERENCES entities (id) ON DELETE SET NULL,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- canonical_name is never renamed. A duplicate would silently split an entity's facts.
CREATE UNIQUE INDEX entities_project_canonical_name_uq
  ON entities (project_id, lower(canonical_name));

CREATE INDEX entities_project_type_idx ON entities (project_id, type);

CREATE TABLE chapters (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arc_id             uuid NOT NULL REFERENCES arcs (id) ON DELETE CASCADE,
  title              text NOT NULL CHECK (length(trim(title)) > 0),
  ordinal            integer NOT NULL CHECK (ordinal >= 0),
  type               chapter_type NOT NULL DEFAULT 'chapter',
  status             chapter_status NOT NULL DEFAULT 'outline',
  pov_entity_id      uuid REFERENCES entities (id) ON DELETE SET NULL,
  outline_goal       text NOT NULL DEFAULT '',
  outline_conflict   text NOT NULL DEFAULT '',
  outline_outcome    text NOT NULL DEFAULT '',
  outline_beat       text NOT NULL DEFAULT '',
  body_md            text NOT NULL DEFAULT '',
  word_count         integer NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  rr_url             text,
  published_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX chapters_arc_ordinal_uq ON chapters (arc_id, ordinal);

CREATE INDEX chapters_pov_idx ON chapters (pov_entity_id);
CREATE INDEX chapters_published_idx ON chapters (published_at) WHERE published_at IS NOT NULL;

CREATE TABLE entity_abilities (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id             uuid NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
  kind                  ability_kind NOT NULL,
  name                  text NOT NULL CHECK (length(trim(name)) > 0),
  first_use_chapter_id  uuid REFERENCES chapters (id) ON DELETE SET NULL,
  cost                  text NOT NULL DEFAULT '',
  limitation            text NOT NULL DEFAULT '',
  notes                 text NOT NULL DEFAULT '',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX entity_abilities_entity_kind_name_uq
  ON entity_abilities (entity_id, kind, lower(name));

CREATE INDEX entity_abilities_first_use_idx
  ON entity_abilities (first_use_chapter_id)
  WHERE first_use_chapter_id IS NOT NULL;

CREATE TABLE relations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  from_entity_id        uuid NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
  to_entity_id          uuid NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
  category              relation_category NOT NULL,
  type_label            text NOT NULL CHECK (length(trim(type_label)) > 0),
  sentiment             smallint CHECK (sentiment BETWEEN -5 AND 5),
  rank                  text,
  valid_from_chapter_id uuid REFERENCES chapters (id) ON DELETE SET NULL,
  valid_to_chapter_id   uuid REFERENCES chapters (id) ON DELETE SET NULL,
  is_secret             boolean NOT NULL DEFAULT false,
  notes                 text NOT NULL DEFAULT '',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- A relation cannot relate an entity to itself.
ALTER TABLE relations
  ADD CONSTRAINT relations_no_self_reference
  CHECK (from_entity_id <> to_entity_id);

-- A relation cannot end before it starts.
ALTER TABLE relations
  ADD CONSTRAINT relations_validity_order
  CHECK (
    valid_from_chapter_id IS NULL
    OR valid_to_chapter_id IS NULL
    OR valid_to_chapter_id <> valid_from_chapter_id
  );

-- sentiment is an arc property of social relations only. possession and membership
-- carry no slope, so a sentiment on them is always a data-entry mistake.
ALTER TABLE relations
  ADD CONSTRAINT relations_sentiment_is_social_only
  CHECK (category = 'social' OR sentiment IS NULL);

-- rank belongs to faction membership only.
ALTER TABLE relations
  ADD CONSTRAINT relations_rank_is_membership_only
  CHECK (category = 'membership' OR rank IS NULL);

CREATE INDEX relations_from_idx ON relations (from_entity_id);
CREATE INDEX relations_to_idx ON relations (to_entity_id);
CREATE INDEX relations_project_category_idx ON relations (project_id, category);

CREATE TABLE relation_known_by (
  relation_id  uuid NOT NULL REFERENCES relations (id) ON DELETE CASCADE,
  entity_id    uuid NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
  PRIMARY KEY (relation_id, entity_id)
);

CREATE INDEX relation_known_by_entity_idx ON relation_known_by (entity_id);

CREATE TABLE facts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  scope_type        fact_scope_type NOT NULL,
  scope_id          uuid,
  kind              fact_kind NOT NULL,
  content           text NOT NULL CHECK (length(trim(content)) > 0),
  -- A fact with no source is unverifiable, and unverifiable facts are how tab drift
  -- starts. Enforced here so no code path, including a future AI pass, can bypass it.
  source_chapter_id uuid NOT NULL REFERENCES chapters (id) ON DELETE CASCADE,
  source_quote      text NOT NULL CHECK (length(trim(source_quote)) > 0),
  status            fact_status NOT NULL DEFAULT 'draft',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- scope_id is polymorphic, so it cannot be a foreign key. Its presence is still
-- required by scope_type, and that IS enforceable.
ALTER TABLE facts
  ADD CONSTRAINT facts_scoped_rows_have_scope_id
  CHECK (scope_type = 'global' OR scope_id IS NOT NULL);

ALTER TABLE facts
  ADD CONSTRAINT facts_global_rows_have_no_scope_id
  CHECK (scope_type = 'global' OR scope_id IS NULL OR scope_type <> 'global');

CREATE INDEX facts_scope_idx ON facts (scope_type, scope_id);
CREATE INDEX facts_project_status_idx ON facts (project_id, status);
CREATE INDEX facts_source_chapter_idx ON facts (source_chapter_id);
CREATE INDEX facts_kind_idx ON facts (kind);

CREATE TABLE glossary_terms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  canonical_form  text NOT NULL CHECK (length(trim(canonical_form)) > 0),
  kind            glossary_kind NOT NULL,
  notes           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX glossary_terms_project_form_uq
  ON glossary_terms (project_id, lower(canonical_form));

CREATE TABLE illustrations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id             uuid NOT NULL REFERENCES chapters (id) ON DELETE CASCADE,
  after_paragraph_index  integer NOT NULL CHECK (after_paragraph_index >= 0),
  local_path             text NOT NULL CHECK (length(trim(local_path)) > 0),
  remote_url             text,
  provider               illustration_provider NOT NULL DEFAULT 'manual',
  width                  integer CHECK (width IS NULL OR width > 0),
  height                 integer CHECK (height IS NULL OR height > 0),
  -- Royal Road requires alt text on every exported image.
  alt_text               text NOT NULL CHECK (length(trim(alt_text)) > 0),
  caption                text NOT NULL DEFAULT '',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX illustrations_chapter_anchor_idx
  ON illustrations (chapter_id, after_paragraph_index);

-- A slot with a local file but no remote url has not been uploaded yet. The export
-- cannot emit a working <img> for it, so the UI must be able to find these cheaply.
CREATE INDEX illustrations_unuploaded_idx
  ON illustrations (chapter_id)
  WHERE remote_url IS NULL;