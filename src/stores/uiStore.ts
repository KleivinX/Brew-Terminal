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
}));
