/**
 * The most assets a comparison will draw.
 *
 * Matched to the categorical palette, which has six slots that were validated for
 * distinguishability against each theme's surface. A seventh series would need a generated
 * colour, and a generated colour is exactly what the palette rules forbid — it would not have
 * been checked against the others.
 */
export const MAX_COMPARE = 6;
