// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { hasLoadingPlaceholder } from '../src/lib/pageTiming';

function root(html: string): HTMLElement {
  const el = document.createElement('main');
  el.innerHTML = html;
  return el;
}

describe('hasLoadingPlaceholder', () => {
  it('detects page and route loading placeholders', () => {
    expect(hasLoadingPlaceholder(root('<p class="muted">Loading…</p>'))).toBe(true);
    expect(hasLoadingPlaceholder(root('<p>Loading book…</p>'))).toBe(true);
    expect(hasLoadingPlaceholder(root('<div class="route-loading">x</div>'))).toBe(true);
  });

  it('ignores loaded content and prose that merely mentions loading', () => {
    expect(hasLoadingPlaceholder(root('<h2>Books</h2><p>Session 7/22</p>'))).toBe(false);
    expect(hasLoadingPlaceholder(root('<p>Reloading the deck takes a moment, so loading is fine.</p>'))).toBe(false);
  });
});
