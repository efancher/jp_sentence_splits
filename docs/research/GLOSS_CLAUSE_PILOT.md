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

## Implementation follow-up

The eight “promising” questions now have an opt-in preview in the sentence
walkthrough on `feat/gloss-clause-preview`. Source text must match exactly; the
UI locates unique UTF-16 spans rather than using the report’s code-point offsets.
Helpful/disputed feedback is local-only, and no review evidence is recorded.
The two “repair-first” examples remain outside the preview. Their narrow repair
preserves chunk IDs and untouched fields, refuses unexpected source/boundaries
or notes on changed chunks, requires a backup before writing, and uses the
analysis version to avoid overwriting concurrent edits.

The two saved repairs were applied and verified on 2026-10-16 (analysis versions
34 and 24 respectively). The original records are backed up in the task workspace
as `pilot-chunks-before-repair.json`. Historical sample data above deliberately
retains the original findings. Both examples remain outside the eight-question
preview pending a separate decision to expand it.

## Expanded ungraded set (2026-10-16)

After the initial learner tryout, added 12 exact-source questions (20 total). These are assistant-drafted and self-reviewed, not independently validated. Existing question IDs and feedback keys remain unchanged. The original 12-candidate study above is historical; the two repaired examples now have questions, while ambiguous/context-dependent candidates remain deferred. Questions ask for explicit grammatical attachment rather than an inferred actor or a forced temporal interpretation.

### `sent_24ed9098-clause-v1`

お母さん鳥は、「そうね」と答えた後、「でもね」と続けました。

Target: **「でもね」と**. Which predicate introduces these quoted words?

Options: 続けました / 答えた. Draft answer: **続けました**.

「でもね」と is the content of 続けました. 答えた introduces the earlier reply 「そうね」; the two quotations belong to different predicates.

### `sent_b7b4b892-clause-v1`

ひなは必死に羽ばたいて、なんとか飛ぶことができました。

Target: **飛ぶ**. Which following word turns this action into a noun-like expression?

Options: こと / なんとか / 必死に. Draft answer: **こと**.

こと nominalizes 飛ぶ. 飛ぶことができました means the chick was able to fly; なんとか describes managing it somehow, not nominalization.

### `sent_091b509b-clause-v1`

もう１羽のひなも、「僕も疲れた」と言いました。

Target: **「僕も疲れた」と**. Which predicate introduces these spoken words?

Options: 言いました / 疲れた. Draft answer: **言いました**.

言いました introduces the quotation. 疲れた is the predicate inside it: the chick says that he is tired too.

### `sent_9842387d-clause-v1`

そして、「さあみんな、羽はこうやって使うのよ」と言って、飛び方を見せました。

Target: **「さあみんな、羽はこうやって使うのよ」と**. Which predicate directly introduces this quotation?

Options: 言って / 見せました / 使う. Draft answer: **言って**.

The quotation is the content of 言って. 見せました describes the accompanying demonstration, while 使う belongs inside the quoted explanation.

### `sent_9fdc7208-clause-v1`

３羽のひなたちは、お母さんの真似をして、必死に飛びました。

Target: **お母さんの真似をして**. Which following event is linked to this clause?

Options: 必死に飛びました / お母さんの真似をして. Draft answer: **必死に飛びました**.

The chicks flew desperately while imitating their mother. The て-form clause links the imitation to the main flying event; it does not say that the mother is the subject of 飛びました.

### `sent_e069c9d6-clause-v1`

そして、羽を大きく広げると、思い切って巣から飛び出しました。

Target: **羽を大きく広げると**. Which following event is linked to this clause?

Options: 思い切って巣から飛び出しました / 羽を大きく広げると. Draft answer: **思い切って巣から飛び出しました**.

Spreading the wings leads into the event of launching from the nest. Here と links the clauses; it is not quoting spoken words.

### `sent_0843827e-clause-v1`

ひなたちは大きな声でピーピーと鳴いて、口を大きく開けました。

Target: **大きな声でピーピーと鳴いて**. Which following event is linked to this clause?

Options: 口を大きく開けました / 大きな声でピーピーと鳴いて. Draft answer: **口を大きく開けました**.

鳴いて connects the chirping to the chicks opening their mouths. Both actions share the topic ひなたちは. The て-form alone need not force a precise before/after ordering.

### `sent_c540c63a-clause-v1`

空は青くて、木々の緑がきれいでした。

Target: **青くて**. Which expression is described as blue?

Options: 空 / 木々の緑. Draft answer: **空**.

空は supplies the topic of 青くて. 木々の緑が belongs to the following predicate きれいでした; the two descriptions are connected by the adjective て-form.

### `sent_89943494-clause-v1`

今日は家族について話します。

Target: **について**. Which preceding noun names what is being talked about?

Options: 家族 / 今日. Draft answer: **家族**.

家族について means about family and supplies the subject matter of 話します. 今日は sets the time/topic frame. について is one compound expression, not に plus an independently glossed verb.

### `sent_abf79c54-clause-v1`

このポッドキャストでは、いろいろなトピックについて、ゆっくりな日本語で話します。

Target: **ゆっくりな**. Which noun is directly modified by this expression?

Options: 日本語 / トピック / ポッドキャスト. Draft answer: **日本語**.

ゆっくりな directly modifies 日本語. The whole phrase ゆっくりな日本語で describes how the speaker talks; いろいろな separately modifies トピック.

### `sent_6497d692-clause-v1`

お母さん鳥は喜んで、ひなと一緒に飛びました。

Target: **喜んで**. Which explicitly stated topic supplies the subject of this clause?

Options: お母さん鳥 / ひな. Draft answer: **お母さん鳥**.

お母さん鳥は supplies the subject of 喜んで and 飛びました. ひなと一緒に says whom the mother bird flew with; it does not make ひな the stated subject of 喜んで.

### `sent_586e4aac-clause-v1`

親鳥は、ひなの口にえさを入れました。

Target: **ひなの**. Which noun is directly modified by this possessive phrase?

Options: 口 / えさ / 親鳥. Draft answer: **口**.

ひなの modifies 口: the chick’s mouth. 口に marks the destination, while えさを is what the parent bird put there.
