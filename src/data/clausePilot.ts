/** Curated, ungraded references. Exact-source matching prevents stale questions. */
import activeQuestions from './activeClauseQuestions.json';

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
    "id": "sent_6be3be8e-clause-v2",
    "source": "ひなたちが全員集まったら、お母さん鳥は木の枝から飛び立ちました。",
    "targetText": "ひなたちが全員集まったら",
    "question": "Which word makes the highlighted part a “when / if” condition for what follows?",
    "options": [
      "集まったら",
      "木の枝から",
      "ひなたちが"
    ],
    "answerText": "集まったら",
    "explanation": "「集まったら」 ends the highlighted part with a conditional form (と, ば or たら), which sets it up as the “when / if” for what follows. 「木の枝から」 and 「ひなたちが」 only fill roles inside one of the two parts; they do not link the parts. This question tests the link itself, without claiming more than the wording supports."
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
    "id": "sent_9fdc7208-clause-v2",
    "source": "３羽のひなたちは、お母さんの真似をして、必死に飛びました。",
    "targetText": "お母さんの真似をして",
    "question": "Which word is in the て-form that links the highlighted part to what follows?",
    "options": [
      "真似をして",
      "飛びました",
      "必死に"
    ],
    "answerText": "真似をして",
    "explanation": "「真似をして」 is in the て-form (or its で counterpart), which joins the highlighted part to the statement that follows. 「飛びました」 and 「必死に」 only fill roles inside one of the two parts; they do not link the parts. This question tests the link itself, without claiming more than the wording supports."
  },
  {
    "id": "sent_e069c9d6-clause-v2",
    "source": "そして、羽を大きく広げると、思い切って巣から飛び出しました。",
    "targetText": "羽を大きく広げると",
    "question": "Which word makes the highlighted part a “when / if” condition for what follows?",
    "options": [
      "広げると",
      "巣から",
      "思い切って"
    ],
    "answerText": "広げると",
    "explanation": "「広げると」 ends the highlighted part with a conditional form (と, ば or たら), which sets it up as the “when / if” for what follows. 「巣から」 and 「思い切って」 only fill roles inside one of the two parts; they do not link the parts. This question tests the link itself, without claiming more than the wording supports."
  },
  {
    "id": "sent_0843827e-clause-v2",
    "source": "ひなたちは大きな声でピーピーと鳴いて、口を大きく開けました。",
    "targetText": "大きな声でピーピーと鳴いて",
    "question": "Which word is in the て-form that links the highlighted part to what follows?",
    "options": [
      "鳴いて",
      "開けました",
      "大きな声で"
    ],
    "answerText": "鳴いて",
    "explanation": "「鳴いて」 is in the て-form (or its で counterpart), which joins the highlighted part to the statement that follows. 「開けました」 and 「大きな声で」 only fill roles inside one of the two parts; they do not link the parts. This question tests the link itself, without claiming more than the wording supports."
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
  },
  ...activeQuestions
] as const;
