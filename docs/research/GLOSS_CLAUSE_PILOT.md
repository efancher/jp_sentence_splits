# Progressive glossing: clause and attachment pilot

Prepared 2026-10-16 from 64 saved chunked sentence analyses. This is a deliberately varied 12-sentence sample, not a random sample or an accuracy benchmark. All references below are assistant-drafted and self-reviewed; none has independent/native-speaker validation. Nothing was written to production or enabled for grading.

## Findings

- 8 promising questions for a learner-facing, ungraded preview.
- 2 questions need the accompanying chunk analysis repaired first.
- 2 sentences are deferred for ambiguity or missing discourse context.
- Several correct dependencies begin or end inside existing chunks. Use source-text spans and validate them against the sentence revision; chunk IDs alone are insufficient.
- A correct syntactic link does not guarantee one English meaning. Avoid forcing “if” versus “when” for たら, or treating a coreferent noun as an incorrect semantic referent.

## Candidate questions

### 1. relative-clause — promising

最初に飛び立ったひなは、近くの木の枝に止まっていました。

Source ID: `sent_1ddbaa71`. Target: **飛び立った**.

Which noun is directly modified by this clause?

Options: ひな / 枝 / 木.

Draft answer: **ひな**. 飛び立った identifies the chick that took off. 最初に belongs inside that description; it does not identify which branch the chick landed on.

Review note: The modifier and head are fused in 飛び立ったひなは、. A chunk-ID answer cannot distinguish them.

### 2. relative-clause — promising

後から飛び立った２羽のひなたちも、みんながいる所まで飛びました。

Source ID: `sent_6a319808`. Target: **みんながいる**.

Which place expression does this describe?

Options: 所 / ひなたち / ２羽.

Draft answer: **所**. みんながいる describes 所: the place where everyone is. The whole place phrase with まで supplies the destination/extent of 飛びました.

Review note: いる所まで fuses the embedded predicate, head noun, and particle. Keep the earlier 後から飛び立った modifier separate.

### 3. relative-clause — promising

その時、お父さん鳥は、前方に、穴が空いている木を見つけました。

Source ID: `sent_9599a175`. Target: **穴が空いている**.

Which noun does this describe?

Options: 木 / お父さん鳥 / 前方.

Draft answer: **木**. The hole is in the tree. 穴が is the subject inside the modifier; 木を is the object of the main 見つけました.

Review note: 空いている木を crosses the clause boundary. Do not let the embedded が become the main-clause subject.

### 4. relative-clause — promising

もう一つは紙、何かを書いたりするやつですね。

Source ID: `sent_c52ed70c`. Target: **何かを書いたりする**.

Which following noun is directly modified by this clause?

Options: やつ / 紙 / もう一つ.

Draft answer: **やつ**. The directly modified head is やつ. 紙 and やつ refer to the same thing here, so ask specifically for the grammatical head, not what the description is about.

Review note: The question asks for the directly modified following noun, so coreferent 紙 is not confused with the syntactic head やつ.

### 5. quotation — promising

お父さん鳥は、「もうだめだ」と思いました。

Source ID: `sent_097e750f`. Target: **「もうだめだ」と**.

Which predicate takes this thought as its content?

Options: 思いました / もうだめだ.

Draft answer: **思いました**. The quoted thought is the content of 思いました. もうだめだ is the predicate inside the thought, not the predicate that introduces it.

Review note: Ask about the host predicate, not the implied subject or an English translation of だめ.

### 6. quotation — promising

「そうね。じゃあ、そろそろ巣に帰りましょう」と、お母さん鳥が言いました。

Source ID: `sent_fdaf0b2d`. Target: **「そうね。じゃあ、そろそろ巣に帰りましょう」と**.

Which predicate introduces these spoken words?

Options: 言いました / 帰りましょう.

Draft answer: **言いました**. The entire quotation attaches to 言いました despite the intervening お母さん鳥が. 帰りましょう belongs inside the quotation.

Review note: The quote crosses several stored chunks and contains punctuation. Match the full quoted span before interpreting sentence-final roles.

### 7. clause-link — promising

ひなたちが全員集まったら、お母さん鳥は木の枝から飛び立ちました。

Source ID: `sent_6be3be8e`. Target: **ひなたちが全員集まったら**.

Which following event is linked to this clause?

Options: お母さん鳥は木の枝から飛び立ちました / ひなたちが全員集まったら.

Draft answer: **お母さん鳥は木の枝から飛び立ちました**. The gathering clause supplies the setting/condition for the mother bird taking off. This structural link is clear without forcing a choice between English “when” and “if”.

Review note: Grade attachment only. Choosing a unique temporal-versus-hypothetical meaning would need discourse context.

### 8. nominalized-clause — promising

１羽のひなが、「飛ぶのって、すごく楽しいね！」と言いました。

Source ID: `sent_a1947e28`. Target: **飛ぶ**.

Which following expression makes this action the topic inside the quotation?

Options: のって / すごく / と言いました.

Draft answer: **のって**. の nominalizes 飛ぶ; the following って presents that action as the topic. The quoted speaker says flying is enjoyable. の here is not a noun-to-noun possessive link.

Review note: The answer deliberately includes the nominalizer plus topic marker. Do not describe って itself as the nominalizer.

### 9. temporal-clause — repair-first

お母さん鳥は、「そうね」と答えた後、「でもね」と続けました。

Source ID: `sent_24ed9098`. Target: **「そうね」と答えた**.

Which time noun does this clause modify?

Options: 後 / お母さん鳥 / 「でもね」.

Draft answer: **後**. 答えた modifies 後: after answering “yes”. The later quoted でもね is content of 続けました, not part of the earlier temporal clause.

Review note: Stored chunks split 「でもね」 across 答えた後、「でも and ね」と and invent a でも-car. Repair the span representation before presenting the walkthrough beside this question.

### 10. nominalized-clause — repair-first

ひなは必死に羽ばたいて、なんとか飛ぶことができました。

Source ID: `sent_b7b4b892`. Target: **飛ぶことが**.

Which predicate completes this ability expression?

Options: できました / 羽ばたいて.

Draft answer: **できました**. 飛ぶことができました expresses being able to fly. The target is the nominalized action that combines with できました, not the earlier flapping action.

Review note: Stored chunks split なんとか into なんと and か飛ぶことが. Do not teach the false と-car. A source-span question is possible after correcting the companion analysis.

### 11. ambiguous-scope — defer

日本で一番人気があるレストランのレビューサイトに、「食べログ」というサイトがあります。

Source ID: `sent_0dce0d45`. Target: **日本で一番人気がある**.

The popularity description can be read with different attachment/scope around レストランのレビューサイト. A single forced answer could penalize a plausible reading.

Review note: Retrieve neighbouring context and editorial intent before choosing a head. No draft graded question.

### 12. fragment — defer

生まれた時から、この小さい場所、山の中。

Source ID: `sent_17d1bdde`. Target: **生まれた時から**.

The visible sentence is a fragment ending この小さい場所、山の中。 Its main predication and discourse connection are incomplete.

Review note: Fetch the neighbouring utterances first. 生まれた is also mislabeled as a copula in the stored analysis; do not infer a clause graph from these roles.

## Recommended next slice

Build an opt-in preview for the eight promising questions, with an attempt followed by explanation and “another answer works” feedback. Keep all responses ungraded and outside FSRS while checking the reference quality. Do not label these references AI-verified or settled merely because a model drafted and re-read them.

Before automatic grading, obtain an independent review of the target spans, correct answers, distractors, and ambiguity decisions. Then validate on unseen sentences with quoted clauses, nested relative clauses, nominalizers, and fragments. Report accepted, rejected, and disputed references separately; the 8/12 candidate count here is not a model accuracy result.

Minimum reference data: sentence ID and source revision/hash; target and answer spans; relation type; question; exact-source distractor spans; explanation; alternative acceptable answers; review provenance/status. Reject stale text and ambiguous span matches. Preserve phrase boundaries across chunks; render code-point offsets correctly in JavaScript (UTF-16 differs for supplementary characters).

No new scheduler, database migration, or grading rule is needed for this pilot. The next implementation should begin with the reviewed preview, not broad AI-generated auto-grading.

## Deployment verification

The latest frontend Pages workflow succeeded on main (run 38838717410). The idle youtube-mining-api service was restarted after confirming no active mining jobs and a completed extras run. `/health` returned `ok`; the live schema exposes `bookSentences`; an existing completed run returned 1,549 original sentences, matching its reported count.

## Reproduce the sample

Run `node --import tsx scripts/sample-gloss-pilot.ts --output /tmp/gloss-candidates.json` from a checkout with the usual script credentials configured. The script reads only the signed-in account’s non-deleted analyses and corresponding sentences. The selected references are in `gloss-clause-pilot.json`; source hashes and exact spans allow stale drafts to be rejected. The full 64-sentence export stays outside git.
