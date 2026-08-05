/**
 * Shared in-memory Set tracking rooms whose execution is currently being
 * resolved. Used by both actionCallbackHandler and GameFlowController to
 * prevent concurrent double-resolution of the same room, which would cause
 * InvalidPhaseActionError and leave the game frozen.
 */
export const resolvingExecutionRooms = new Set<string>();
