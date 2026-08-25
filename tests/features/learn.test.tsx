import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { LearnRoute } from '@/features/learn/LearnRoute';
import { GlossaryIndex } from '@/features/learn/GlossaryIndex';
import { ExplainWithModel } from '@/features/learn/ExplainWithModel';
import { searchGlossary, glossary, learningPaths } from '@/features/learn/content';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

function renderLearn(route = '/learn') {
  return renderWithProviders(
    <Routes>
      <Route path="/learn/*" element={<LearnRoute />} />
      <Route path="/desk" element={<p>Model Desk</p>} />
    </Routes>,
    { route },
  );
}

describe('Learn — content', () => {
  it('loads the whole bundle with no network involved', () => {
    /*
     * The offline requirement, asserted at its root: the content is a module import, so
     * there is no request to fail. `fetch` being untouched is the proof.
     */
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(glossary.length).toBeGreaterThanOrEqual(40);
    expect(learningPaths.length).toBeGreaterThanOrEqual(5);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('searches by term, alias and description', () => {
    expect(searchGlossary('spread').some((e) => e.id === 'spread')).toBe(true);
    // "shares" is an alias of Stock, not its term.
    expect(searchGlossary('shares').some((e) => e.id === 'stock')).toBe(true);
    // "APY" is an alias of Yield.
    expect(searchGlossary('APY').some((e) => e.id === 'yield')).toBe(true);
  });

  it('returns everything for an empty query and nothing for nonsense', () => {
    expect(searchGlossary('')).toHaveLength(glossary.length);
    expect(searchGlossary('zzzqqqxxx')).toHaveLength(0);
  });
});

describe('Learn — navigation', () => {
  it('lists the five paths on the home page', async () => {
    renderLearn();

    await waitFor(() => expect(screen.getByText('Stocks Basics')).toBeInTheDocument());
    for (const title of [
      'Crypto Basics',
      'Reading Financial News',
      'Risk and Scams',
      'How Markets Work',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('opens a glossary entry and follows a related term', async () => {
    const user = userEvent.setup();
    renderLearn('/learn/glossary/spread');

    await waitFor(() =>
      expect(screen.getByText(/The gap between the highest price/)).toBeInTheDocument(),
    );

    // Every entry links onward, so the glossary is browsable rather than a dead end.
    const related = screen.getByRole('navigation', { name: /related terms/i });
    await user.click(within(related).getByRole('link', { name: /Liquidity/ }));

    await waitFor(() =>
      expect(screen.getByText(/How easily an asset can be bought or sold/)).toBeInTheDocument(),
    );
  });

  it('filters the glossary as the user types', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlossaryIndex />);

    await user.type(screen.getByLabelText(/search the glossary/i), 'staking');

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Staking/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /^Dividend/ })).not.toBeInTheDocument();
  });

  it('explains an empty search result', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlossaryIndex />);

    await user.type(screen.getByLabelText(/search the glossary/i), 'zzzqqq');
    await waitFor(() => expect(screen.getByText(/No terms match that/i)).toBeInTheDocument());
  });

  it('filters by category', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlossaryIndex />);

    await user.click(screen.getByRole('button', { name: 'Crypto' }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Blockchain/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /^P\/E ratio/ })).not.toBeInTheDocument();
  });

  it('says so when a term does not exist', async () => {
    renderLearn('/learn/glossary/not-a-real-term');
    await waitFor(() => expect(screen.getByText(/no glossary entry called/i)).toBeInTheDocument());
  });
});

describe('Learn — progress', () => {
  it('marks a lesson as read and reflects it on the path', async () => {
    const user = userEvent.setup();
    renderLearn('/learn/path/stocks-basics/what-a-share-is');

    await waitFor(() =>
      expect(screen.getByText(/What you own when you own a share/)).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: /mark as read/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /mark as unread/i })).toBeInTheDocument(),
    );
  });

  it('persists progress across a remount', async () => {
    const user = userEvent.setup();
    const { unmount } = renderLearn('/learn/path/crypto-basics/what-a-blockchain-is');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /mark as read/i })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: /mark as read/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /mark as unread/i })).toBeInTheDocument(),
    );

    unmount();

    // Not resetting the harness is the point: this asserts it was actually stored.
    renderWithProviders(
      <Routes>
        <Route path="/learn/*" element={<LearnRoute />} />
      </Routes>,
      { route: '/learn/path/crypto-basics', resetHarness: false },
    );

    await waitFor(() => expect(screen.getByText(/1 of 4 read/)).toBeInTheDocument());
  });

  it('resets progress for a path', async () => {
    // One render, navigated by clicking — two renders would put two copies of the app in the
    // document and reset the harness between them.
    const user = userEvent.setup();
    renderLearn('/learn/path/risk-and-scams');

    await waitFor(() => expect(screen.getByText(/0 of 3 read/)).toBeInTheDocument());

    await user.click(screen.getByRole('link', { name: /What risk actually means here/ }));
    await user.click(await screen.findByRole('button', { name: /mark as read/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /mark as unread/i })).toBeInTheDocument(),
    );

    // Back to the path via the breadcrumb.
    await user.click(screen.getByRole('link', { name: /Risk and Scams · lesson 1 of 3/ }));
    await waitFor(() => expect(screen.getByText(/1 of 3 read/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /reset this path/i }));
    await user.click(screen.getByRole('button', { name: /^reset$/i }));

    await waitFor(() => expect(screen.getByText(/0 of 3 read/)).toBeInTheDocument());
  });
});

describe('Learn — Explain this', () => {
  it('shows exactly what would be sent before anything leaves', async () => {
    /*
     * AI_POLICY.md §2: nothing is sent without a direct action, and the exact text is shown
     * first — itemised, not summarised.
     */
    const user = userEvent.setup();
    renderWithProviders(<ExplainWithModel term="Spread" short="The gap between bid and ask." />);

    await user.click(screen.getByRole('button', { name: /explain this/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Spread: The gap between bid and ask.')).toBeInTheDocument();
  });

  it('says the model is off rather than pretending to send', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExplainWithModel term="Spread" short="The gap between bid and ask." />);

    await user.click(screen.getByRole('button', { name: /explain this/i }));

    await waitFor(() =>
      expect(screen.getByText(/Model Desk is switched off/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/would leave your computer/i)).toBeInTheDocument();
    expect(screen.getByText(/sends nothing at all/i)).toBeInTheDocument();
  });

  it('carries the educational disclaimer', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExplainWithModel term="Spread" short="The gap." />);

    await user.click(screen.getByRole('button', { name: /explain this/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/Educational information only — not financial advice/),
      ).toBeInTheDocument(),
    );
  });
});

describe('Learn — accessibility', () => {
  it('has no violations on the home page', async () => {
    const { container } = renderLearn();
    await waitFor(() => expect(screen.getByText('Stocks Basics')).toBeInTheDocument());

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });

  it('has no violations on the glossary', async () => {
    const { container } = renderWithProviders(<GlossaryIndex />);
    await waitFor(() => expect(screen.getByLabelText(/search the glossary/i)).toBeInTheDocument());

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });

  it('has no violations on a lesson', async () => {
    const { container } = renderLearn('/learn/path/how-markets-work/orders');
    await waitFor(() => expect(screen.getByText(/The two basic instructions/)).toBeInTheDocument());

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});
