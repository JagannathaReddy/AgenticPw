-- 20260702101407_pgvector_setup.sql
-- Install pgvector and add embedding columns for future semantic recall.
-- Q1 installs but doesn't query — Q2's Generator uses it for RAG.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- Embed the extracted repo profile so we can compare "similar repos" later
-- (used for cross-tenant learnings that are anonymized).
ALTER TABLE repo_profiles
  ADD COLUMN IF NOT EXISTS profile_embedding vector(1536);   -- text-embedding-3-small

-- Embed each test file summary so the Generator's RAG can pick k-nearest
-- neighbors. Backfill will run in Q2 when RAG turns on.
CREATE TABLE IF NOT EXISTS test_file_embeddings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo_id        UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_path      TEXT NOT NULL,                     -- e.g. 'tests/cart/add-item.spec.ts'
  file_sha       TEXT NOT NULL,                     -- content hash for change detection
  summary        TEXT NOT NULL,                     -- one-paragraph LLM summary
  embedding      vector(1536) NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo_id, file_path)
);

CREATE INDEX IF NOT EXISTS test_file_embeddings_workspace_idx
  ON test_file_embeddings (workspace_id);
CREATE INDEX IF NOT EXISTS test_file_embeddings_repo_idx
  ON test_file_embeddings (repo_id);

-- IVFFlat index for approximate nearest-neighbor. Created empty; tune lists
-- when we have >= 10k rows in Q2.
CREATE INDEX IF NOT EXISTS test_file_embeddings_ivfflat
  ON test_file_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- RLS ---------------------------------------------------------------------
ALTER TABLE test_file_embeddings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS test_file_embeddings_scope ON test_file_embeddings;
CREATE POLICY test_file_embeddings_scope ON test_file_embeddings
  USING (workspace_id = current_workspace_id() OR is_system_context());

COMMIT;
