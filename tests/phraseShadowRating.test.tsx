import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { PhraseShadowRating } from '../src/components/PhraseShadowRating';
import { resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';

describe('PhraseShadowRating', () => {
  beforeEach(() => {
    resetDbForTests(`phrase-rating-${createId('db')}`);
  });

  it("logs the learner's own call for the marked span, without touching reviews", async () => {
    const user = userEvent.setup();
    render(
      <PhraseShadowRating
        bookId="b1"
        sentenceId="s1"
        sentenceAudioId="a1"
        clipDurationMs={2000}
        range={{ startMs: 500, endMs: 1200 }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(async () => expect(await getDb().sentenceLearningEvents.count()).toBe(1));
    const [event] = await getDb().sentenceLearningEvents.toArray();
    expect(event).toMatchObject({
      action: 'phrase_shadow', outcome: 'close', assessmentSource: 'self', rangeStartMs: 500, rangeEndMs: 1200,
    });
    expect(await screen.findByText(/Logged “Close”/)).toBeTruthy();
    expect(await getDb().reviews.count()).toBe(0);
  });

  it("logs under the reader tool's visit when given one, so it groups with the Read check's follow-up offer", async () => {
    const user = userEvent.setup();
    render(
      <PhraseShadowRating
        bookId="b1"
        sentenceId="s1"
        sentenceAudioId="a1"
        clipDurationMs={2000}
        range={{ startMs: 500, endMs: 1200 }}
        visitId="visit-from-reader"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(async () => expect(await getDb().sentenceLearningEvents.count()).toBe(1));
    expect((await getDb().sentenceLearningEvents.toArray())[0]).toMatchObject({ action: 'phrase_shadow', visitId: 'visit-from-reader' });
  });

  it('shows the words of the marked span so the learner knows which phrase they are rating', async () => {
    await getDb().referenceAlignments.put({
      id: 'a1', alignmentVersion: 1, computedAt: '2026-11-04T00:00:00.000Z',
      result: {
        durationSeconds: 2,
        words: [
          { text: '猫', start: 0, end: 0.4, phones: [] },
          { text: 'が', start: 0.4, end: 0.5, phones: [] },
          { text: '寝ています', start: 0.5, end: 1.6, phones: [] },
        ],
      },
    });
    render(
      <PhraseShadowRating
        bookId="b1"
        sentenceId="s1"
        sentenceAudioId="a1"
        clipDurationMs={2000}
        range={{ startMs: 450, endMs: 1650 }}
      />,
    );
    expect(await screen.findByText('寝ています')).toBeTruthy();
  });
});
