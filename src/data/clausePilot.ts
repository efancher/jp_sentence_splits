/** Curated, ungraded pilot references. Exact-source matching prevents stale questions. */
export const CLAUSE_PILOT = [
  {
    "id": "sent_1ddbaa71-clause-v1",
    "source": "最初に飛び立ったひなは、近くの木の枝に止まっていました。",
    "targetText": "飛び立った",
    "question": "Which noun is directly modified by this clause?",
    "options": [
      "ひな",
      "枝",
      "木"
    ],
    "answerText": "ひな",
    "explanation": "飛び立った identifies the chick that took off. 最初に belongs inside that description; it does not identify which branch the chick landed on."
  },
  {
    "id": "sent_6a319808-clause-v1",
    "source": "後から飛び立った２羽のひなたちも、みんながいる所まで飛びました。",
    "targetText": "みんながいる",
    "question": "Which place expression does this describe?",
    "options": [
      "所",
      "ひなたち",
      "２羽"
    ],
    "answerText": "所",
    "explanation": "みんながいる describes 所: the place where everyone is. The whole place phrase with まで supplies the destination/extent of 飛びました."
  },
  {
    "id": "sent_9599a175-clause-v1",
    "source": "その時、お父さん鳥は、前方に、穴が空いている木を見つけました。",
    "targetText": "穴が空いている",
    "question": "Which noun does this describe?",
    "options": [
      "木",
      "お父さん鳥",
      "前方"
    ],
    "answerText": "木",
    "explanation": "The hole is in the tree. 穴が is the subject inside the modifier; 木を is the object of the main 見つけました."
  },
  {
    "id": "sent_c52ed70c-clause-v1",
    "source": "もう一つは紙、何かを書いたりするやつですね。",
    "targetText": "何かを書いたりする",
    "question": "Which following noun is directly modified by this clause?",
    "options": [
      "やつ",
      "紙",
      "もう一つ"
    ],
    "answerText": "やつ",
    "explanation": "The directly modified head is やつ. 紙 and やつ refer to the same thing here, so ask specifically for the grammatical head, not what the description is about."
  },
  {
    "id": "sent_097e750f-clause-v1",
    "source": "お父さん鳥は、「もうだめだ」と思いました。",
    "targetText": "「もうだめだ」と",
    "question": "Which predicate takes this thought as its content?",
    "options": [
      "思いました",
      "もうだめだ"
    ],
    "answerText": "思いました",
    "explanation": "The quoted thought is the content of 思いました. もうだめだ is the predicate inside the thought, not the predicate that introduces it."
  },
  {
    "id": "sent_fdaf0b2d-clause-v1",
    "source": "「そうね。じゃあ、そろそろ巣に帰りましょう」と、お母さん鳥が言いました。",
    "targetText": "「そうね。じゃあ、そろそろ巣に帰りましょう」と",
    "question": "Which predicate introduces these spoken words?",
    "options": [
      "言いました",
      "帰りましょう"
    ],
    "answerText": "言いました",
    "explanation": "The entire quotation attaches to 言いました despite the intervening お母さん鳥が. 帰りましょう belongs inside the quotation."
  },
  {
    "id": "sent_6be3be8e-clause-v1",
    "source": "ひなたちが全員集まったら、お母さん鳥は木の枝から飛び立ちました。",
    "targetText": "ひなたちが全員集まったら",
    "question": "Which following event is linked to this clause?",
    "options": [
      "お母さん鳥は木の枝から飛び立ちました",
      "ひなたちが全員集まったら"
    ],
    "answerText": "お母さん鳥は木の枝から飛び立ちました",
    "explanation": "The gathering clause supplies the setting/condition for the mother bird taking off. This structural link is clear without forcing a choice between English “when” and “if”."
  },
  {
    "id": "sent_a1947e28-clause-v1",
    "source": "１羽のひなが、「飛ぶのって、すごく楽しいね！」と言いました。",
    "targetText": "飛ぶ",
    "question": "Which following expression makes this action the topic inside the quotation?",
    "options": [
      "のって",
      "すごく",
      "と言いました"
    ],
    "answerText": "のって",
    "explanation": "の nominalizes 飛ぶ; the following って presents that action as the topic. The quoted speaker says flying is enjoyable. の here is not a noun-to-noun possessive link."
  }
] as const;
