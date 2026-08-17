import { RoleId, NightActionType, Team } from '../engine/domain/enums';
import { RoomState } from '../engine/domain/Room';
import { PlayerState } from '../engine/domain/Player';
import { TargetOption } from './presenters/keyboards';

export type BotPersonality = 'cautious' | 'aggressive' | 'deceptive' | 'quiet';
export type BotObservationType = 'DISCUSSION' | 'ACCUSATION' | 'DEFENSE' | 'VOTE';

export interface BotInspectionResult {
  seerTelegramId: string;
  targetTelegramId: string;
  targetNickname: string;
  revealedTeam: string;
  revealedRole: string | null;
}

export interface BotObservation {
  type: BotObservationType;
  round: number;
  actorTelegramId: string;
  targetTelegramId?: string | null;
  text?: string;
}

export interface BotTelemetrySnapshot {
  observationCount: number;
  discussionCount: number;
  accusationCount: number;
  defenseCount: number;
  voteCount: number;
  skipVoteCount: number;
  observations: BotObservation[];
}

export interface BotBeliefState {
  knownWerewolvesByBot: Map<string, Set<string>>;
  knownVillagersByBot: Map<string, Set<string>>;
  publicSuspicionByTarget: Map<string, number>;
  seerBotTelegramId?: string;
  lastInspectResult?: BotInspectionResult;
}

export interface BotPolicyOptions {
  random?: () => number;
  personalityByBot?: Map<string, BotPersonality>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isPersonality(value: string | undefined): value is BotPersonality {
  return value === 'cautious' || value === 'aggressive' || value === 'deceptive' || value === 'quiet';
}

export class BotPolicy {
  private readonly random: () => number;
  private readonly personalityByBot: Map<string, BotPersonality>;
  private readonly beliefsByRoom = new Map<string, BotBeliefState>();
  private readonly observationsByRoom = new Map<string, BotObservation[]>();
  private readonly completedTelemetryByRoom = new Map<string, BotTelemetrySnapshot>();

  constructor(options: BotPolicyOptions = {}) {
    this.random = options.random ?? Math.random;
    this.personalityByBot = options.personalityByBot ?? new Map();
  }

  startRoom(roomId: string): BotBeliefState {
    const state: BotBeliefState = {
      knownWerewolvesByBot: new Map(),
      knownVillagersByBot: new Map(),
      publicSuspicionByTarget: new Map(),
    };
    this.beliefsByRoom.set(roomId, state);
    this.observationsByRoom.set(roomId, []);
    this.completedTelemetryByRoom.delete(roomId);
    return state;
  }

  getState(roomId: string): BotBeliefState {
    return this.beliefsByRoom.get(roomId) ?? this.startRoom(roomId);
  }

  clearRoom(roomId: string): void {
    this.completedTelemetryByRoom.set(roomId, this.getTelemetry(roomId));
    this.beliefsByRoom.delete(roomId);
    this.observationsByRoom.delete(roomId);
  }

  getPersonality(botTelegramId: string): BotPersonality {
    const configured = process.env.BOT_PERSONALITY?.toLowerCase();
    if (isPersonality(configured)) return configured;

    const explicitlyAssigned = this.personalityByBot.get(botTelegramId);
    if (explicitlyAssigned) return explicitlyAssigned;

    const numericSuffix = Number(botTelegramId.replace(/\D/g, '').slice(-2)) || 0;
    return (['cautious', 'aggressive', 'deceptive', 'quiet'] as BotPersonality[])[numericSuffix % 4];
  }

  recordInspection(roomId: string, result: BotInspectionResult): void {
    const state = this.getState(roomId);
    state.seerBotTelegramId = result.seerTelegramId;
    const knownWerewolves = state.knownWerewolvesByBot.get(result.seerTelegramId) ?? new Set<string>();
    const knownVillagers = state.knownVillagersByBot.get(result.seerTelegramId) ?? new Set<string>();
    if (result.revealedTeam === Team.WEREWOLF) {
      knownWerewolves.add(result.targetTelegramId);
    } else {
      knownVillagers.add(result.targetTelegramId);
    }
    state.knownWerewolvesByBot.set(result.seerTelegramId, knownWerewolves);
    state.knownVillagersByBot.set(result.seerTelegramId, knownVillagers);
    state.lastInspectResult = result;
  }

  consumeLastInspection(roomId: string): BotInspectionResult | undefined {
    const state = this.getState(roomId);
    const result = state.lastInspectResult;
    state.lastInspectResult = undefined;
    return result;
  }

  addPublicSuspicion(roomId: string, targetTelegramId: string, delta: number): void {
    if (!targetTelegramId) return;
    const state = this.getState(roomId);
    const current = state.publicSuspicionByTarget.get(targetTelegramId) ?? 0;
    state.publicSuspicionByTarget.set(targetTelegramId, clamp(current + delta, -2, 2));
  }

  recordObservation(roomId: string, observation: BotObservation): void {
    const observations = this.observationsByRoom.get(roomId) ?? [];
    observations.push(observation);
    this.observationsByRoom.set(roomId, observations.slice(-200));
  }

  getTelemetry(roomId: string): BotTelemetrySnapshot {
    const activeObservations = this.observationsByRoom.get(roomId);
    if (!activeObservations && this.completedTelemetryByRoom.has(roomId)) {
      return this.completedTelemetryByRoom.get(roomId)!;
    }
    const observations = [...(activeObservations ?? [])];
    return {
      observationCount: observations.length,
      discussionCount: observations.filter((item) => item.type === 'DISCUSSION').length,
      accusationCount: observations.filter((item) => item.type === 'ACCUSATION').length,
      defenseCount: observations.filter((item) => item.type === 'DEFENSE').length,
      voteCount: observations.filter((item) => item.type === 'VOTE').length,
      skipVoteCount: observations.filter((item) => item.type === 'VOTE' && item.targetTelegramId === null).length,
      observations,
    };
  }

  shouldClaimInspection(botTelegramId: string, revealedTeam: string): boolean {
    const personality = this.getPersonality(botTelegramId);
    const baseProbability: Record<BotPersonality, number> = {
      cautious: 0.9,
      aggressive: 0.95,
      deceptive: revealedTeam === Team.WEREWOLF ? 0.75 : 0.45,
      quiet: 0.35,
    };
    return this.random() < baseProbability[personality];
  }

  chooseNightTarget(
    room: RoomState,
    actor: PlayerState,
    targets: TargetOption[],
    roomId: string,
  ): TargetOption | null {
    if (targets.length === 0) return null;
    const state = this.getState(roomId);

    if (actor.role === RoleId.WEREWOLF) {
      const existingWolfAction = room.pendingNightActions.find(
        (action) => action.actionType === NightActionType.WEREWOLF_VOTE_KILL && action.round === room.currentRound,
      );
      if (existingWolfAction) {
        return targets.find((target) => target.telegramId === existingWolfAction.targetTelegramId) ?? null;
      }
      const nonWolfTargets = targets.filter((target) => room.players[target.telegramId]?.role !== RoleId.WEREWOLF);
      if (nonWolfTargets.length > 0) {
        const claimedSeer = state.seerBotTelegramId
          ? nonWolfTargets.find((target) => target.telegramId === state.seerBotTelegramId)
          : null;
        return claimedSeer ?? this.pickSuspicionWeightedTarget(nonWolfTargets, state.publicSuspicionByTarget, true);
      }
    }

    if (actor.role === RoleId.BODYGUARD) {
      const eligibleTargets = targets.filter(
        (target) => room.lastProtectedByBodyguard[actor.telegramId] !== target.telegramId,
      );
      if (eligibleTargets.length === 0) return null;
      const seerTarget = state.seerBotTelegramId
        ? eligibleTargets.find((target) => target.telegramId === state.seerBotTelegramId)
        : null;
      if (seerTarget && room.players[seerTarget.telegramId]?.alive && this.random() < 0.9) return seerTarget;
      return this.pickRandomTarget(eligibleTargets);
    }

    if (actor.role === RoleId.HUNTER) {
      const eligibleTargets = targets.filter(
        (target) => room.lastTargetedByHunter?.[actor.telegramId] !== target.telegramId,
      );
      return this.pickRandomTarget(eligibleTargets);
    }

    if (actor.role === RoleId.SEER) {
      const knownWerewolves = state.knownWerewolvesByBot.get(actor.telegramId) ?? new Set<string>();
      const knownVillagers = state.knownVillagersByBot.get(actor.telegramId) ?? new Set<string>();
      const unknownTargets = targets.filter(
        (target) => target.telegramId !== actor.telegramId
          && !knownWerewolves.has(target.telegramId)
          && !knownVillagers.has(target.telegramId),
      );
      if (unknownTargets.length > 0) {
        return this.pickSuspicionWeightedTarget(unknownTargets, state.publicSuspicionByTarget);
      }
    }

    return this.pickRandomTarget(targets);
  }

  chooseVoteTarget(
    room: RoomState,
    player: PlayerState,
    aliveTargets: TargetOption[],
    roomId: string,
  ): TargetOption | null {
    const candidates = aliveTargets.filter((target) => target.telegramId !== player.telegramId);
    if (candidates.length === 0) return null;
    const state = this.getState(roomId);
    const knownWerewolves = state.knownWerewolvesByBot.get(player.telegramId) ?? new Set<string>();

    if (player.role === RoleId.SEER) {
      const knownWolfTargets = candidates.filter((target) => knownWerewolves.has(target.telegramId));
      if (knownWolfTargets.length > 0) return this.pickSuspicionWeightedTarget(knownWolfTargets, state.publicSuspicionByTarget);
    }

    if (player.role === RoleId.WEREWOLF) {
      const nonWolfTargets = candidates.filter(
        (target) => room.players[target.telegramId]?.role !== RoleId.WEREWOLF,
      );
      if (nonWolfTargets.length > 0) return this.pickSuspicionWeightedTarget(nonWolfTargets, state.publicSuspicionByTarget, true);
    }

    const abstainProbability: Record<BotPersonality, number> = {
      cautious: 0.25,
      aggressive: 0.04,
      deceptive: 0.08,
      quiet: 0.2,
    };
    if (this.random() < abstainProbability[this.getPersonality(player.telegramId)]) return null;
    return this.pickSuspicionWeightedTarget(candidates, state.publicSuspicionByTarget);
  }

  private pickRandomTarget(targets: TargetOption[]): TargetOption | null {
    if (targets.length === 0) return null;
    return targets[Math.floor(this.random() * targets.length)];
  }

  private pickSuspicionWeightedTarget(
    targets: TargetOption[],
    suspicionByTarget: Map<string, number>,
    invert = false,
  ): TargetOption | null {
    if (targets.length === 0) return null;
    const weights = targets.map((target) => {
      const score = suspicionByTarget.get(target.telegramId) ?? 0;
      const adjustedScore = clamp(invert ? -score : score, -3, 3);
      return Math.exp(adjustedScore);
    });
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let pick = this.random() * totalWeight;
    for (let index = 0; index < targets.length; index += 1) {
      pick -= weights[index];
      if (pick <= 0) return targets[index];
    }
    return targets[targets.length - 1];
  }
}
