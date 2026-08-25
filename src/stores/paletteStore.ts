import { create } from 'zustand';

interface PaletteState {
  open: boolean;
  /** Seeds the input — lets "Add to watchlist…" open the palette pre-filtered. */
  initialQuery: string;
  openPalette: (initialQuery?: string) => void;
  closePalette: () => void;
  togglePalette: () => void;
}

export const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  initialQuery: '',
  openPalette: (initialQuery = '') => set({ open: true, initialQuery }),
  closePalette: () => set({ open: false, initialQuery: '' }),
  togglePalette: () => set((s) => ({ open: !s.open, initialQuery: '' })),
}));
