/**
 * The typed handle on the main process.
 *
 * This is the renderer's only route to the database. There is no fetch, no SQL,
 * and no fs anywhere in src/: every read and write goes through these calls,
 * which preload forwards to a validated IPC handler.
 *
 * The types come from electron/ipc/contract.ts, the same file the main process
 * validates against, so a payload change breaks compilation on both sides at
 * once rather than failing silently at runtime.
 */
export interface StoryBoardBridge {
  entities: {
    list(input: { projectId: string; type?: 'character' | 'place' | 'faction' | 'item' | 'rule' }): Promise<Entity[]>;
    create(input: {
      projectId: string;
      type: 'character' | 'place' | 'faction' | 'item' | 'rule';
      canonicalName: string;
      aliases?: string[];
      summary?: string;
      originEntityId?: string | null;
    }): Promise<Entity>;
    update(input: {
      id: string;
      summary?: string;
      appearance?: string;
      personality?: string;
      backstory?: string;
      originEntityId?: string | null;
      metadata?: Record<string, unknown>;
    }): Promise<Entity>;
    addAlias(input: { id: string; alias: string }): Promise<Entity>;
    remove(input: { id: string }): Promise<void>;
  };
  relations: {
    list(input: { projectId: string; entityId?: string; category?: RelationCategory }): Promise<RelationWithKnowledge[]>;
    create(input: CreateRelationInput): Promise<RelationWithKnowledge>;
    remove(input: { id: string }): Promise<void>;
  };
  facts: {
    list(input: {
      projectId: string;
      scopeType?: FactScopeType;
      scopeId?: string;
      kind?: FactKind;
      status?: FactStatus;
    }): Promise<Fact[]>;
    create(input: {
      projectId: string;
      scopeType: FactScopeType;
      scopeId: string | null;
      kind: FactKind;
      content: string;
      sourceChapterId: string;
      sourceQuote: string;
      status?: FactStatus;
    }): Promise<Fact>;
    setStatus(input: { id: string; status: FactStatus }): Promise<Fact>;
    remove(input: { id: string }): Promise<void>;
  };
  outline: {
    list(input: { projectId: string }): Promise<OutlineTree>;
    describeDeletion(input: { kind: OutlineNodeKind; id: string }): Promise<OutlineDeletionImpact>;
    createVolume(input: { projectId: string; title: string; summary?: string }): Promise<Volume>;
    updateVolume(input: { id: string; title?: string; summary?: string }): Promise<Volume>;
    removeVolume(input: { id: string }): Promise<void>;
    createArc(input: { volumeId: string; title: string; summary?: string }): Promise<Arc>;
    updateArc(input: { id: string; title?: string; summary?: string }): Promise<Arc>;
    removeArc(input: { id: string }): Promise<void>;
  };
  chapters: {
    listByArc(input: { arcId: string }): Promise<Chapter[]>;
    get(input: { id: string }): Promise<Chapter>;
    create(input: { arcId: string; title: string; type?: ChapterType; status?: ChapterStatus }): Promise<Chapter>;
    remove(input: { id: string }): Promise<void>;
    saveProse(input: {
      id: string;
      bodyMd: string;
      authorNotePre: string;
      authorNotePost: string;
    }): Promise<Chapter>;
    saveOutline(input: SaveChapterOutlineInput): Promise<Chapter>;
    /** Moves a chapter one position within its arc. */
    move(input: { id: string; direction: 'up' | 'down' }): Promise<void>;
  };
  glossary: {
    list(input: { projectId: string }): Promise<GlossaryTerm[]>;
    save(input: {
      projectId: string;
      canonicalForm: string;
      kind: GlossaryKind;
      notes?: string;
    }): Promise<GlossaryTerm>;
  };
  illustrations: {
    listByChapter(input: { chapterId: string }): Promise<Illustration[]>;
    createSlot(input: {
      chapterId: string;
      afterParagraphIndex: number;
      localPath: string;
      altText: string;
      width?: number | null;
      height?: number | null;
    }): Promise<Illustration>;
    updateSlot(input: {
      id: string;
      afterParagraphIndex: number;
      altText: string;
      caption?: string;
    }): Promise<Illustration>;
    uploadToHost(input: { id: string }): Promise<Illustration>;
    pickImage(input?: Record<string, never>): Promise<PickImageResult>;
  };
  /**
   * The first step of the export pipeline and the only one that writes nothing.
   * Reviewed before any file is written to disk.
   */
  release: {
    previewChapter(input: { chapterId: string }): Promise<ChapterRelease>;
    /**
     * Writes one volume to a `.docx` the author chooses a location for, which is the
     * only form of publishing available: Royal Road has no API.
     */
    exportVolumeDocx(input: { volumeId: string }): Promise<VolumeDocxExportResult>;
    /** Writes one chapter as a standalone `.html` file. */
    exportChapterHtml(input: { chapterId: string }): Promise<ChapterHtmlExportResult>;
  };
  archive: {
    exportProject(input: { projectId: string }): Promise<ArchiveExportResult>;
  };
  /**
   * Manual backup of the manuscript database.
   *
   * Pressing the button returns what was written and where, which is the point: the
   * author needs a recovery location, not a "done" toast.
   */
  backup: {
    status(input: Record<string, never>): Promise<BackupStatus>;
    run(input: Record<string, never>): Promise<BackupRunResult>;
  };
  /**
   * Closing the window without losing prose.
   *
   * `setDirty` is called on every change of unsaved state; `onSaveAndQuit` fires when
   * the author chose "Save and quit" in the native close prompt.
   */
  editorSafety: {
    setDirty(input: { isDirty: boolean }): Promise<void>;
    confirmQuit(input: Record<string, never>): Promise<void>;
    onSaveAndQuit(handler: () => void): () => void;
  };
  drafts: {
    save(input: {
      chapterId: string;
      bodyMd: string;
      authorNotePre: string;
      authorNotePost: string;
    }): Promise<void>;
    read(input: { chapterId: string }): Promise<CrashDraft | null>;
    clear(input: { chapterId: string }): Promise<void>;
  };
  projects: {
    list(input?: { includeArchived?: boolean }): Promise<Project[]>;
    create(input: {
      title: string;
      kind?: ProjectKind;
      exportProfile?: ExportProfile;
      summary?: string;
    }): Promise<Project>;
    update(input: {
      id: string;
      title?: string;
      kind?: ProjectKind;
      exportProfile?: ExportProfile;
      summary?: string;
    }): Promise<Project>;
    archive(input: { id: string }): Promise<Project>;
    getActive(input?: Record<string, never>): Promise<{ projectId: string | null }>;
    setActive(input: { projectId: string }): Promise<void>;
  };
  search: {
    query(input: { projectId: string; query: string }): Promise<SearchResult[]>;
  };
}

/** One recall result: an entity, a glossary term, or a fact. */
export interface SearchResult {
  kind: 'entity' | 'glossary' | 'fact';
  id: string;
  title: string;
  detail: string;
  chapterId: string | null;
  entityType: EntityType | null;
}

export type ProjectKind = 'light_novel' | 'novel';
export type ExportProfile = 'royal_road' | 'plain';

/** A work: one manuscript with its own cast and continuity record. */
export interface Project {
  id: string;
  title: string;
  kind: ProjectKind;
  exportProfile: ExportProfile;
  summary: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A crash-recovery copy of the editor buffer. Never canon until restored. */
export interface CrashDraft {
  chapterId: string;
  savedAt: string;
  bodyMd: string;
  authorNotePre: string;
  authorNotePost: string;
}

export type EntityType = 'character' | 'place' | 'faction' | 'item' | 'rule';
export type RelationCategory = 'social' | 'possession' | 'membership';
export type FactScopeType = 'chapter' | 'entity' | 'relation' | 'global';
export type FactKind =
  | 'event'
  | 'character_fact'
  | 'new_entity'
  | 'relation_shift'
  | 'open_promise'
  | 'unresolved';
export type FactStatus = 'draft' | 'approved' | 'rejected';
export type ChapterType = 'chapter' | 'prologue' | 'epilogue' | 'interlude';
export type ChapterStatus = 'outline' | 'draft' | 'done';
export type OutlineNodeKind = 'volume' | 'arc' | 'chapter';
export type GlossaryKind = 'name' | 'term' | 'honorific' | 'style';

export interface Volume {
  id: string;
  projectId: string;
  title: string;
  ordinal: number;
  summary: string;
  createdAt: string;
}

export interface Arc {
  id: string;
  volumeId: string;
  title: string;
  ordinal: number;
  summary: string;
  createdAt: string;
}

/** A chapter as the outline tree sees it: no prose, no outline fields. */
export interface OutlineChapterSummary {
  id: string;
  arcId: string;
  title: string;
  ordinal: number;
  type: ChapterType;
  status: ChapterStatus;
  povEntityId: string | null;
  wordCount: number;
  publishedAt: string | null;
}

export interface OutlineArcNode extends Arc {
  chapters: OutlineChapterSummary[];
}

export interface OutlineVolumeNode extends Volume {
  arcs: OutlineArcNode[];
}

export interface OutlineTree {
  volumes: OutlineVolumeNode[];
}

/** What a deletion would destroy, counted from the real tables. */
export interface OutlineDeletionImpact {
  kind: OutlineNodeKind;
  title: string;
  childCount: number;
  factCount: number;
  illustrationCount: number;
  wordCount: number;
}

export interface Entity {
  id: string;
  projectId: string;
  type: EntityType;
  canonicalName: string;
  aliases: string[];
  summary: string;
  appearance: string;
  personality: string;
  backstory: string;
  originEntityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RelationWithKnowledge {
  id: string;
  projectId: string;
  fromEntityId: string;
  toEntityId: string;
  fromName: string;
  toName: string;
  category: RelationCategory;
  typeLabel: string;
  sentiment: number | null;
  rank: string | null;
  validFromChapterId: string | null;
  validToChapterId: string | null;
  isSecret: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
  knownBy: { id: string; canonicalName: string }[];
}

export interface CreateRelationInput {
  projectId: string;
  fromEntityId: string;
  toEntityId: string;
  category: RelationCategory;
  typeLabel: string;
  sentiment?: number | null;
  rank?: string | null;
  validFromChapterId?: string | null;
  validToChapterId?: string | null;
  isSecret?: boolean;
  notes?: string;
  knownByEntityIds?: string[];
}

export interface Fact {
  id: string;
  projectId: string;
  scopeType: FactScopeType;
  scopeId: string | null;
  kind: FactKind;
  content: string;
  sourceChapterId: string;
  sourceQuote: string;
  status: FactStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Chapter {
  id: string;
  arcId: string;
  title: string;
  ordinal: number;
  type: ChapterType;
  status: ChapterStatus;
  povEntityId: string | null;
  outlineGoal: string;
  outlineConflict: string;
  outlineOutcome: string;
  outlineBeat: string;
  bodyMd: string;
  authorNotePre: string;
  authorNotePost: string;
  wordCount: number;
  rrUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The outline fields of a chapter that may be patched independently of its prose.
 * Every field is optional: a patch carries only what the author actually changed,
 * so saving a title cannot blank the goal the author wrote last week.
 */
export interface SaveChapterOutlineInput {
  id: string;
  title?: string;
  type?: ChapterType;
  status?: ChapterStatus;
  povEntityId?: string | null;
  outlineGoal?: string;
  outlineConflict?: string;
  outlineOutcome?: string;
  outlineBeat?: string;
  /** Publication tracking; null clears it. */
  rrUrl?: string | null;
  publishedAt?: string | null;
}

export interface GlossaryTerm {
  id: string;
  projectId: string;
  canonicalForm: string;
  kind: GlossaryKind;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Illustration {
  id: string;
  chapterId: string;
  afterParagraphIndex: number;
  localPath: string;
  remoteUrl: string | null;
  provider: 'catbox' | 'imgbb' | 'manual';
  width: number | null;
  height: number | null;
  altText: string;
  caption: string;
  createdAt: string;
  updatedAt: string;
}

/** What the image picker returned. Dimensions are read by the main process. */
export type PickImageResult =
  | {
      status: 'picked';
      filePath: string;
      width: number | null;
      height: number | null;
    }
  | { status: 'cancelled' };

/** How badly a preview problem affects publishing. */
export type ReleaseSeverity = 'blocker' | 'warning';

/** Machine-readable causes, so the preview can group them. */
export type ReleaseWarningCode =
  | 'not_finished'
  | 'too_short'
  | 'over_length'
  | 'unconverted_markdown'
  | 'unuploaded_image'
  | 'missing_alt'
  | 'unknown_dimensions'
  | 'anchor_out_of_range'
  | 'dropped_image'
  | 'dropped_author_note'
  | 'no_publishable_chapters';

/** One thing the author needs to know before publishing. */
export interface ReleaseWarning {
  code: ReleaseWarningCode;
  severity: ReleaseSeverity;
  message: string;
}

/**
 * One block of the chapter body in publication order.
 *
 * Images are separate blocks because their anchor is a paragraph index, so they sit
 * between paragraphs rather than inside one.
 */
export type ReleaseBlock =
  | { kind: 'paragraph'; html: string; paragraphIndex: number }
  | {
      kind: 'image';
      imageHtml: string;
      captionHtml: string;
      illustrationId: string;
      afterParagraphIndex: number;
      isMisplaced: boolean;
    };

/** What one chapter will look like once published. */
export interface ChapterRelease {
  chapterId: string;
  title: string;
  preNoteHtml: string;
  blocks: ReleaseBlock[];
  postNoteHtml: string;
  wordCount: number;
  isExcluded: boolean;
  exclusionReason: string | null;
  warnings: ReleaseWarning[];
}

/**
 * What a volume `.docx` export produced.
 *
 * Cancellation is an outcome rather than an error because closing the save dialog is a
 * decision. The counts on a written file are the only record that illustrations and
 * author notes were left behind, since the document itself cannot carry them.
 */
export type VolumeDocxExportResult =
  | { status: 'cancelled' }
  | {
      status: 'written';
      filePath: string;
      volumeTitle: string;
      chapterCount: number;
      excludedChapterCount: number;
      droppedImageCount: number;
      droppedNoteCount: number;
      warnings: ReleaseWarning[];
    };

/** What one chapter's `.html` export produced. */
export type ChapterHtmlExportResult =
  | { status: 'cancelled' }
  | {
      status: 'written';
      filePath: string;
      chapterTitle: string;
      bytes: number;
      warnings: ReleaseWarning[];
    };

/** What the whole-work JSON archive produced. */
export type ArchiveExportResult =
  | { status: 'cancelled' }
  | {
      status: 'written';
      filePath: string;
      projectTitle: string;
      chapterCount: number;
      entityCount: number;
      factCount: number;
      relationCount: number;
      glossaryCount: number;
      bytes: number;
    };

/**
 * One verified backup file on disk.
 *
 * `filePath` is shown to the author because a backup they cannot find is a backup
 * they do not have.
 */
export interface BackupFileInfo {
  fileName: string;
  filePath: string;
  bytes: number;
  createdAt: string;
}

/** What the backup screen knows before the author presses anything. */
export interface BackupStatus {
  directory: string;
  isMirrorConfigured: boolean;
  lastBackup: BackupFileInfo | null;
}

/** What one backup wrote, and what it left behind. */
export interface BackupRunResult {
  file: BackupFileInfo;
  counts: {
    chapters: number;
    entities: number;
    facts: number;
    relations: number;
  };
  removed: string[];
  mirrorPath: string | null;
}

/**
 * Returns the bridge, or null when the renderer is running outside Electron.
 *
 * The null case is real: `npm run dev` opens a plain browser tab with no preload
 * script and no main process. Rather than crashing on an undefined property, the
 * app detects this and says so, which is also how the "open a browser tab by
 * mistake" case gets a useful message.
 */
export function getBridge(): StoryBoardBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return (window as { storyboard?: StoryBoardBridge }).storyboard ?? null;
}

/** Narrows an unknown caught value to an Error with a readable message. */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'Something went wrong.';
}