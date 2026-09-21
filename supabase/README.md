# Supabase assets

| Path | Purpose |
| --- | --- |
| `migrations/20260722000000_sync_schema.sql` | Tables, triggers, RLS, Storage bucket |
| `migrations/20260813000000_unified_study_model.sql` | Sources, vocabulary/kanji relationships, study items, reviews |
| `migrations/20260815000000_review_evidence_foundation.sql` | Review assistance/source/context-sentence columns, vocabulary_confusions table |
| `migrations/20260816000000_sentence_vocabulary_surface_form.sql` | sentence_vocabulary.surface_form column |
| `migrations/20260903120000_sentence_vocabulary_audio_range.sql` | sentence_vocabulary.audio_start_ms / audio_end_ms columns (manual word-audio span) |
| `migrations/20260816010000_study_item_vocabulary_confusion_subject.sql` | study_items.subject_type check constraint widened for 'vocabularyConfusion' |
| `migrations/20260818000000_card_issue_reports.sql` | card_issue_reports table |
| `migrations/20260819000000_grammar_learning_foundation.sql` | Grammar-learning system: grammar_patterns, sentence_grammar, grammar_relationships, analyses.grammar_suggestions, study_items.subject_type widened for 'grammarPattern' |
| `migrations/20260904000000_sync_issue_reports.sql` | sync_issue_reports table (learner-reported sync trouble, bundled diagnostics snapshot) |
| `migrations/20260921000000_pitch_drill_takes.sql` | pitch_drill_takes table + private drill-takes bucket (the learner's drill recordings, alignment, pitch, labels) |
| `functions/invite-book-member/` | Edge Function for email invites |
| `functions/grammar-assist/` | Edge Function: AI-assisted grammar-pattern suggestion/explanation (Claude Haiku via the Anthropic API; requires `ANTHROPIC_API_KEY` function secret) |
| `functions/vocab-assist/` | Edge Function: AI-assisted vocabulary meaning glossing in sentence context (Claude Haiku; same `ANTHROPIC_API_KEY` secret) |
| `tests/rls_expectations.md` | Multi-user RLS verification outline |

Migrations apply automatically when they land on `main`: `.github/workflows/apply-migrations.yml` runs `supabase db push` (needs repo secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`), then verifies with `check:migrations-applied`. (The Supabase GitHub integration's "Deploy to production" is not enabled on this plan.) The history table was baselined with the 24 earlier migrations on 2026-09-21; a migration applied by hand must also be inserted into `supabase_migrations.schema_migrations`, or the workflow will try to re-run it. Manual fallback: Dashboard SQL Editor or `supabase db push`. `npm run check:migrations-applied` (read-only) reports any table/column the migrations create that prod lacks.

Setup guide: [`docs/supabase-setup.md`](../docs/supabase-setup.md).
