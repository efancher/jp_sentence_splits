import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { normalizeForPasteMatch } from '../src/lib/normalize';
import { orderBookSentencesFromPaste } from '../src/lib/pasteOrder';

const PASTE = `春、第一話
暖かい春がやって来ました。空は青くて、木々の緑がきれいでした。
ある小鳥の夫婦が、木に巣を作りました。そして、小鳥の奥さんは、卵を３つ産みました。２週間後、ひなが生まれました。巣から、３羽のひなたちが顔を出しました。とっても可愛いひなたちでした。
親鳥がえさを運んで来ました。ひなたちは大きな声でピーピーと鳴いて、口を大きく開けました。親鳥は、ひなの口にえさを入れました。ひなたちはみんな、おいしそうにえさを食べました。
親鳥たちは、毎日、一生懸命にひなたちの世話をしました。ひなたちは、毎日少しずつ大きくなりました。しばらくすると、お母さんとお父さんの真似をして、羽をバタバタさせ始めました。

春、第二話
ある日、１羽のひなが巣の端に立ちました。そして、羽を大きく広げると、思い切って巣から飛び出しました。ひなは必死に羽ばたいて、なんとか飛ぶことができました。お母さん鳥は喜んで、ひなと一緒に飛びました。
他の２羽のひなたちは、巣からその様子を見ていました。そして、真似をして羽をバタバタさせていました。しばらくすると、もう１羽が巣から飛び出しました。しかし、最後の１羽は怖がりで、なかなか飛び出すことができませんでした。
２番目に飛び出したひなが、「大丈夫だよ。早くおいでよ！」と言いました。最後の１羽は勇気を出して、「えい！」と言って巣から飛び出しました。そして、必死に羽ばたきました。すると、体がふわりと浮いて、飛ぶことができました。
春、第三話
最初に飛び立ったひなは、近くの木の枝に止まっていました。親鳥たちも一緒にいました。後から飛び立った２羽のひなたちも、みんながいる所まで飛びました。
ひなたちが全員集まったら、お母さん鳥は木の枝から飛び立ちました。そして、「さあみんな、羽はこうやって使うのよ」と言って、飛び方を見せました。３羽のひなたちは、お母さんの真似をして、必死に飛びました。すると、最初は下手でしたが、だんだん上手に飛べるようになりました。
そこで、お母さん鳥はもう少し高い所までみんなを連れて行きました。お父さん鳥は、ひなたちの後ろを飛んで、みんなを見守っていました。
お母さん鳥が、「風が気持ちいいでしょ」と言いました。
ひなたちは、「うん、とっても気持ちいいよ」と答えました。

春、第四話
１羽のひなが、「飛ぶのって、すごく楽しいね！」と言いました。お母さん鳥は、「そうね」と答えた後、「でもね」と続けました。
「外の世界には、怖いワシやタカもいるの。捕まらないように、十分に気を付けてね」
ひなたちは真剣な顔で、「うん、分かった」と答えました。
しばらくすると、１羽のひなが、「お母さん、少し疲れたよ。巣に帰ろうよ」と言いました。もう１羽のひなも、「僕も疲れた」と言いました。
「そうね。じゃあ、そろそろ巣に帰りましょう」と、お母さん鳥が言いました。
その時、横から、ものすごいスピードでタカが飛んできました。お父さん鳥が、「あぶない！」と叫びました。`;

const BACKUP = resolve(
  process.env.HOME ?? '',
  'tmp/satori/satori-glossbook-backup-2026-07-22.json',
);

describe('paste order against phone backup', () => {
  it('reorders spring new life so ある日 precedes 他の２羽', () => {
    let raw: string;
    try {
      raw = readFileSync(BACKUP, 'utf8');
    } catch {
      // Local phone backup fixture; skip when absent (CI).
      return;
    }
    const data = JSON.parse(raw) as {
      books: { id: string; title: string }[];
      sentences: { id: string; japanese: string }[];
      bookSentences: {
        bookId: string;
        sentenceId: string;
        position: number;
      }[];
    };
    const book = data.books.find((item) => item.title === 'spring new life');
    expect(book).toBeTruthy();
    const sentencesById = new Map(
      data.sentences.map((sentence) => [sentence.id, sentence]),
    );
    const memberships = data.bookSentences
      .filter((item) => item.bookId === book!.id)
      .sort((a, b) => a.position - b.position);
    const sentences = memberships.map((membership) => ({
      id: membership.sentenceId,
      japanese: sentencesById.get(membership.sentenceId)?.japanese ?? '',
    }));

    const day = sentences.find((item) => item.japanese.startsWith('ある日'));
    const others = sentences.find((item) => item.japanese.includes('他の２羽'));
    expect(day && others).toBeTruthy();

    const pasteKey = normalizeForPasteMatch(PASTE);
    const dayIdx = pasteKey.indexOf(normalizeForPasteMatch(day!.japanese));
    const othersIdx = pasteKey.indexOf(
      normalizeForPasteMatch(others!.japanese),
    );
    expect(dayIdx).toBeGreaterThanOrEqual(0);
    expect(othersIdx).toBeGreaterThan(dayIdx);

    const result = orderBookSentencesFromPaste(PASTE, sentences);
    const ordered = result.orderedIds.map(
      (id) => sentences.find((item) => item.id === id)!.japanese,
    );
    const dayOrder = ordered.findIndex((japanese) =>
      japanese.startsWith('ある日'),
    );
    const othersOrder = ordered.findIndex((japanese) =>
      japanese.includes('他の２羽'),
    );

    // eslint-disable-next-line no-console
    console.log({
      before: {
        day: memberships.find((m) => m.sentenceId === day!.id)?.position,
        others: memberships.find((m) => m.sentenceId === others!.id)?.position,
      },
      match: { dayIdx, othersIdx },
      after: { dayOrder, othersOrder },
      dayUnmatched: result.unmatchedIds.includes(day!.id),
      othersUnmatched: result.unmatchedIds.includes(others!.id),
      unmatchedCount: result.unmatchedIds.length,
      unmatchedSample: result.unmatchedIds.slice(0, 8).map((id) =>
        sentences.find((item) => item.id === id)?.japanese,
      ),
    });

    expect(result.unmatchedIds.includes(day!.id)).toBe(false);
    expect(dayOrder).toBeLessThan(othersOrder);
  });
});
