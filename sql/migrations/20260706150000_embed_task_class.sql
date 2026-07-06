-- 20260706150000_embed_task_class.sql
-- Add 'embed' to the llm_calls.task_class check (Sprint 8: semantic RAG).
-- Embedding calls are metered in the same ledger as completions so
-- `agent cost` and the per-manifest budget gate see them.

BEGIN;

ALTER TABLE llm_calls DROP CONSTRAINT IF EXISTS llm_calls_task_class_check;

ALTER TABLE llm_calls ADD CONSTRAINT llm_calls_task_class_check CHECK (
  task_class IN ('plan', 'generate', 'classify', 'verify', 'embed')
);

COMMIT;
