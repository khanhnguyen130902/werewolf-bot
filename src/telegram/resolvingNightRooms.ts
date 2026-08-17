/**
 * Shared in-memory Set tracking rooms whose night resolution/transition is
 * currently being processed. Used by both actionCallbackHandler and
 * GameFlowController to prevent concurrent double-resolution/double-transition
 * of the night phase, which would cause duplicate prompts, double-transitions,
 * and system errors.
 */
export const resolvingNightRooms = new Set<string>();
