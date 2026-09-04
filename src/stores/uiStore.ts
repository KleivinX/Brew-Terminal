import { create } from 'zustand';
import type { MockBehavior } from '@/lib/ipc';

/**
 * Ephemeral UI state only. Anything durable lives in SQLite; anything provider-sourced lives
 * in TanStack Query. See ADR-011.
 */
interface UiState {
  /** Rail expansion mirrors a preference, but the store drives the frame-level render. */
  navRailExpanded: boolean;
  setNavRailExpanded: (expanded: boolean) => void;
  toggleNavRail: () => void;

  /** Dev-only: which failure mode the mock provider is simulating. */
  mockBehavior: MockBehavior;
  setMockBehavior: (behavior: MockBehavior) => void;

  /** Keyboard selection in the active table, by asset id. */
  selectedAssetId: string | null;
  setSelectedAssetId: (id: string | null) => void;

  /** Which watchlist the Watchlist tab is showing. Null falls back to the default list. */
  selectedWatchlistId: string | null;
  setSelectedWatchlistId: (id: string | null) => void;

  /**
   * Counts explicit requests to see the introduction again.
   *
   * A counter rather than a boolean, and separate from the `onboardingCompleted` preference,
   * because the dialog has to tell two things apart that look identical in the preference: a
   * deliberate replay, and an optimistic write that failed and rolled the flag back to false.
   * Watching a counter means only the first of those re-opens it, so a broken preference write
   * cannot trap someone behind a dialog that will not stay shut.
   */
  onboardingReplays: number;
  replayOnboarding: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  navRailExpanded: false,
  setNavRailExpanded: (navRailExpanded) => set({ navRailExpanded }),
  toggleNavRail: () => set((s) => ({ navRailExpanded: !s.navRailExpanded })),

  mockBehavior: 'normal',
  setMockBehavior: (mockBehavior) => set({ mockBehavior }),

  selectedAssetId: null,
  setSelectedAssetId: (selectedAssetId) => set({ selectedAssetId }),

  selectedWatchlistId: null,
  setSelectedWatchlistId: (selectedWatchlistId) => set({ selectedWatchlistId }),

  onboardingReplays: 0,
  replayOnboarding: () => set((s) => ({ onboardingReplays: s.onboardingReplays + 1 })),
}));
