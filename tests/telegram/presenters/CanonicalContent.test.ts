import { RoleId, NightActionType } from '../../../src/engine/domain/enums';
import {
  ACTION_BUTTON_LABELS,
  ACTION_DISPLAY_NAMES,
  CANONICAL_HELP_TEXT,
  CANONICAL_MESSAGES,
  ROLE_DISPLAY_NAMES,
  ROLE_EMOJIS,
} from '../../../src/telegram/presenters/canonicalContent';

describe('canonical content regression', () => {
  it('keeps exactly seven canonical role names and emojis', () => {
    expect(Object.keys(ROLE_DISPLAY_NAMES)).toHaveLength(7);
    expect(ROLE_DISPLAY_NAMES[RoleId.SILENT_MAGE]).toBe('Pháp sư câm');
    expect(ROLE_DISPLAY_NAMES[RoleId.WEREWOLF]).toBe('Sói');
    expect(ROLE_EMOJIS[RoleId.SILENT_MAGE]).toBe('🤫');
    expect(new Set(Object.values(ROLE_DISPLAY_NAMES)).size).toBe(7);
  });

  it('keeps stable action labels for every supported night action', () => {
    for (const action of [
      NightActionType.WEREWOLF_VOTE_KILL,
      NightActionType.BODYGUARD_PROTECT,
      NightActionType.SEER_INSPECT,
      NightActionType.WITCH_SAVE,
      NightActionType.WITCH_POISON,
      NightActionType.SILENT_MAGE_SILENCE,
      NightActionType.HUNTER_SHOOT,
    ]) {
      expect(ACTION_DISPLAY_NAMES[action]).toBeTruthy();
      expect(ACTION_BUTTON_LABELS[action]).toBeTruthy();
    }
    expect(ACTION_BUTTON_LABELS[NightActionType.SILENT_MAGE_SILENCE]).toBe('🤫 Làm câm');
  });

  it('requires unique message IDs and explicit audience metadata', () => {
    const messages = Object.values(CANONICAL_MESSAGES);
    expect(new Set(messages.map((message) => message.id)).size).toBe(messages.length);
    for (const message of messages) {
      expect(message.event).toBeTruthy();
      expect(message.audience).toBeTruthy();
      expect(message.priority).toBeTruthy();
      expect(message.text).toBeTruthy();
    }
  });

  it('keeps the onboarding content within Telegram limits and includes the full command surface', () => {
    expect(CANONICAL_HELP_TEXT.length).toBeLessThanOrEqual(4096);
    for (const command of ['/start', '/create', '/join', '/leave', '/status', '/vote', '/startgame', '/end', '/bottest', '/help']) {
      expect(CANONICAL_HELP_TEXT).toContain(command);
    }
  });
});
