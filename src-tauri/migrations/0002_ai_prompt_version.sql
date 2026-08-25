-- Records which version of the guardrail system prompt a conversation was held under.
--
-- AI_POLICY.md §4 requires this: the prompt will change, and without the version an old
-- transcript cannot be read back with any confidence about what rules produced it. Existing
-- rows predate any send — the Model Desk shipped in Phase 5 — so the default is accurate
-- rather than a guess.
ALTER TABLE ai_conversations ADD COLUMN system_prompt_version TEXT NOT NULL DEFAULT 'v1';
