/**
 * How often the board asks for a new snapshot.
 *
 * Three minutes. The two hazard feeds publish every minute, so this is never more than a
 * couple of minutes behind them, and it is polite to four public services that charge nothing
 * and impose no quota — which is precisely why it would be poor manners to poll them hard.
 *
 * Not a preference, for the same reason Atlas's cadence is not: a faster interval would not
 * make an earthquake feed produce more earthquakes.
 */
export const REFRESH_MS = 180_000;

/** Zoom bounds. 1 is the whole world; 8 puts a European country across the pane. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 1.6;

/**
 * Marker radius in projected units, before zoom.
 *
 * Markers are drawn with `vector-effect` off and scaled inversely with zoom, so a marker keeps
 * the same size on screen as the map grows underneath it. A marker that scaled with the map
 * would be a continent wide at 8×.
 */
export const MARKER_RADIUS = 7;

/** Extra radius per unit of `scale` — earthquake magnitude, in practice. */
export const MARKER_SCALE_STEP = 1.6;
