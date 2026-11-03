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
});
