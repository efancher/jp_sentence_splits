# Supabase assets

| Path | Purpose |
| --- | --- |
| `migrations/20260722000000_sync_schema.sql` | Tables, triggers, RLS, Storage bucket |
| `migrations/20260813000000_unified_study_model.sql` | Sources, vocabulary/kanji relationships, study items, reviews |
| `migrations/20260815000000_review_evidence_foundation.sql` | Review assistance/source/context-sentence columns, vocabulary_confusions table |
| `migrations/20260816000000_sentence_vocabulary_surface_form.sql` | sentence_vocabulary.surface_form column |
| `migrations/20260816010000_study_item_vocabulary_confusion_subject.sql` | study_items.subject_type check constraint widened for 'vocabularyConfusion' |
| `migrations/20260818000000_card_issue_reports.sql` | card_issue_reports table |
| `migrations/20260819000000_grammar_learning_foundation.sql` | Grammar-learning system: grammar_patterns, sentence_grammar, grammar_relationships, analyses.grammar_suggestions, study_items.subject_type widened for 'grammarPattern' |
| `functions/invite-book-member/` | Edge Function for email invites |
| `functions/grammar-assist/` | Edge Function: AI-assisted grammar-pattern suggestion/explanation (Claude Haiku via the Anthropic API; requires `ANTHROPIC_API_KEY` function secret) |
| `tests/rls_expectations.md` | Multi-user RLS verification outline |

Apply migrations via the Dashboard SQL Editor or `supabase db push`.

Setup guide: [`docs/supabase-setup.md`](../docs/supabase-setup.md).
