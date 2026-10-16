/** Curated, ungraded references. Exact-source matching prevents stale questions. */
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
  },
  {
    "id": "sent_24ed9098-clause-v1",
    "source": "お母さん鳥は、「そうね」と答えた後、「でもね」と続けました。",
    "targetText": "「でもね」と",
    "question": "Which predicate introduces these quoted words?",
    "options": [
      "続けました",
      "答えた"
    ],
    "answerText": "続けました",
    "explanation": "「でもね」と is the content of 続けました. 答えた introduces the earlier reply 「そうね」; the two quotations belong to different predicates."
  },
  {
    "id": "sent_b7b4b892-clause-v1",
    "source": "ひなは必死に羽ばたいて、なんとか飛ぶことができました。",
    "targetText": "飛ぶ",
    "question": "Which following word turns this action into a noun-like expression?",
    "options": [
      "こと",
      "なんとか",
      "必死に"
    ],
    "answerText": "こと",
    "explanation": "こと nominalizes 飛ぶ. 飛ぶことができました means the chick was able to fly; なんとか describes managing it somehow, not nominalization."
  },
  {
    "id": "sent_091b509b-clause-v1",
    "source": "もう１羽のひなも、「僕も疲れた」と言いました。",
    "targetText": "「僕も疲れた」と",
    "question": "Which predicate introduces these spoken words?",
    "options": [
      "言いました",
      "疲れた"
    ],
    "answerText": "言いました",
    "explanation": "言いました introduces the quotation. 疲れた is the predicate inside it: the chick says that he is tired too."
  },
  {
    "id": "sent_9842387d-clause-v1",
    "source": "そして、「さあみんな、羽はこうやって使うのよ」と言って、飛び方を見せました。",
    "targetText": "「さあみんな、羽はこうやって使うのよ」と",
    "question": "Which predicate directly introduces this quotation?",
    "options": [
      "言って",
      "見せました",
      "使う"
    ],
    "answerText": "言って",
    "explanation": "The quotation is the content of 言って. 見せました describes the accompanying demonstration, while 使う belongs inside the quoted explanation."
  },
  {
    "id": "sent_9fdc7208-clause-v1",
    "source": "３羽のひなたちは、お母さんの真似をして、必死に飛びました。",
    "targetText": "お母さんの真似をして",
    "question": "Which following event is linked to this clause?",
    "options": [
      "必死に飛びました",
      "お母さんの真似をして"
    ],
    "answerText": "必死に飛びました",
    "explanation": "The chicks flew desperately while imitating their mother. The て-form clause links the imitation to the main flying event; it does not say that the mother is the subject of 飛びました."
  },
  {
    "id": "sent_e069c9d6-clause-v1",
    "source": "そして、羽を大きく広げると、思い切って巣から飛び出しました。",
    "targetText": "羽を大きく広げると",
    "question": "Which following event is linked to this clause?",
    "options": [
      "思い切って巣から飛び出しました",
      "羽を大きく広げると"
    ],
    "answerText": "思い切って巣から飛び出しました",
    "explanation": "Spreading the wings leads into the event of launching from the nest. Here と links the clauses; it is not quoting spoken words."
  },
  {
    "id": "sent_0843827e-clause-v1",
    "source": "ひなたちは大きな声でピーピーと鳴いて、口を大きく開けました。",
    "targetText": "大きな声でピーピーと鳴いて",
    "question": "Which following event is linked to this clause?",
    "options": [
      "口を大きく開けました",
      "大きな声でピーピーと鳴いて"
    ],
    "answerText": "口を大きく開けました",
    "explanation": "鳴いて connects the chirping to the chicks opening their mouths. Both actions share the topic ひなたちは. The て-form alone need not force a precise before/after ordering."
  },
  {
    "id": "sent_c540c63a-clause-v1",
    "source": "空は青くて、木々の緑がきれいでした。",
    "targetText": "青くて",
    "question": "Which expression is described as blue?",
    "options": [
      "空",
      "木々の緑"
    ],
    "answerText": "空",
    "explanation": "空は supplies the topic of 青くて. 木々の緑が belongs to the following predicate きれいでした; the two descriptions are connected by the adjective て-form."
  },
  {
    "id": "sent_89943494-clause-v1",
    "source": "今日は家族について話します。",
    "targetText": "について",
    "question": "Which preceding noun names what is being talked about?",
    "options": [
      "家族",
      "今日"
    ],
    "answerText": "家族",
    "explanation": "家族について means about family and supplies the subject matter of 話します. 今日は sets the time/topic frame. について is one compound expression, not に plus an independently glossed verb."
  },
  {
    "id": "sent_abf79c54-clause-v1",
    "source": "このポッドキャストでは、いろいろなトピックについて、ゆっくりな日本語で話します。",
    "targetText": "ゆっくりな",
    "question": "Which noun is directly modified by this expression?",
    "options": [
      "日本語",
      "トピック",
      "ポッドキャスト"
    ],
    "answerText": "日本語",
    "explanation": "ゆっくりな directly modifies 日本語. The whole phrase ゆっくりな日本語で describes how the speaker talks; いろいろな separately modifies トピック."
  },
  {
    "id": "sent_6497d692-clause-v1",
    "source": "お母さん鳥は喜んで、ひなと一緒に飛びました。",
    "targetText": "喜んで",
    "question": "Which explicitly stated topic supplies the subject of this clause?",
    "options": [
      "お母さん鳥",
      "ひな"
    ],
    "answerText": "お母さん鳥",
    "explanation": "お母さん鳥は supplies the subject of 喜んで and 飛びました. ひなと一緒に says whom the mother bird flew with; it does not make ひな the stated subject of 喜んで."
  },
  {
    "id": "sent_586e4aac-clause-v1",
    "source": "親鳥は、ひなの口にえさを入れました。",
    "targetText": "ひなの",
    "question": "Which noun is directly modified by this possessive phrase?",
    "options": [
      "口",
      "えさ",
      "親鳥"
    ],
    "answerText": "口",
    "explanation": "ひなの modifies 口: the chick’s mouth. 口に marks the destination, while えさを is what the parent bird put there."
  }
] as const;
