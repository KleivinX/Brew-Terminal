/**
 * How often Atlas asks for a new tick.
 *
 * Ninety seconds sits in the middle of the 60–120s band the free tiers can sustain. It is not a
 * user preference on purpose: the allowances this rotates through are per-minute, so a five
 * second cadence would spend a whole tier's minute in one tick and return nothing but rate
 * limits. The interval is part of what makes the feature work.
 */
export const REFRESH_MS = 90_000;
