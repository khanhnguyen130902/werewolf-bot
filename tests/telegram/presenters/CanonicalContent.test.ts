import fs from 'node:fs';
import path from 'node:path';
import { RoleId, NightActionType } from '../../../src/engine/domain/enums';
import {
  ACTION_BUTTON_LABELS,
  ACTION_DISPLAY_NAMES,
  CANONICAL_HELP_TEXT,
  CANONICAL_MESSAGES,
  ROLE_DISPLAY_NAMES,
  ROLE_EMOJIS,
} from '../../../src/telegram/presenters/canonicalContent';
import { Messages, RoleNames } from '../../../src/telegram/presenters/messages';

describe('canonical content regression', () => {
  it('keeps exactly seven canonical role names and stable visual anchors', () => {
    expect(Object.keys(ROLE_DISPLAY_NAMES)).toHaveLength(7);
    expect(ROLE_DISPLAY_NAMES[RoleId.SILENT_MAGE]).toBe('Pháp sư câm');
    expect(Object.values(ROLE_DISPLAY_NAMES)).toEqual([
      'Dân làng',
      'Sói',
      'Thợ săn',
      'Tiên tri',
      'Bảo vệ',
      'Phù thủy',
      'Pháp sư câm',
    ]);
    expect(ROLE_EMOJIS[RoleId.SILENT_MAGE]).toBe('🤫');
    expect(RoleNames[RoleId.SILENT_MAGE]).toBe('🤫 Pháp sư câm');
    expect(RoleNames[RoleId.SILENT_MAGE]).not.toContain('🧞');
    expect(new Set(Object.values(ROLE_DISPLAY_NAMES)).size).toBe(7);
  });

  it('keeps stable action labels and short imperative button labels', () => {
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
      expect(ACTION_BUTTON_LABELS[action]!.length).toBeLessThanOrEqual(24);
    }
    expect(ACTION_BUTTON_LABELS[NightActionType.SILENT_MAGE_SILENCE]).toBe('🤫 Làm câm');
    expect(ACTION_BUTTON_LABELS[NightActionType.BODYGUARD_PROTECT]).toBe('🛡️ Bảo vệ');
  });

  it('requires unique message IDs, explicit layers, and audience metadata', () => {
    const messages = Object.values(CANONICAL_MESSAGES);
    expect(new Set(messages.map((message) => message.id)).size).toBe(messages.length);
    for (const message of messages) {
      expect(message.event).toBeTruthy();
      expect(message.audience).toBeTruthy();
      expect(message.priority).toBeTruthy();
      expect(message.layer).toBeTruthy();
      expect(message.text).toBeTruthy();
    }
  });

  it('keeps onboarding within Telegram limits and includes the full command surface', () => {
    expect(CANONICAL_HELP_TEXT.length).toBeLessThanOrEqual(4096);
    for (const command of ['/start', '/create', '/join', '/leave', '/status', '/vote', '/startgame', '/end', '/bottest', '/help']) {
      expect(CANONICAL_HELP_TEXT).toContain(command);
    }
  });

  it('keeps player-facing source files free of Markdown bold markers', () => {
    const sourceFiles = [
      'src/telegram/presenters/canonicalContent.ts',
      'src/telegram/presenters/messages.ts',
      'src/telegram/presenters/translateError.ts',
      'src/telegram/handlers/actionCallbackHandler.ts',
      'src/telegram/GameFlowController.ts',
    ];
    for (const sourceFile of sourceFiles) {
      const source = fs.readFileSync(path.resolve(process.cwd(), sourceFile), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(source).not.toContain('**');
    }
  });

  it('prevents forbidden horror, hostile, and divergent terminology patterns', () => {
    const allText = [
      CANONICAL_HELP_TEXT,
      ...Object.values(CANONICAL_MESSAGES).map((message) => message.text),
      Messages.roleAssigned(RoleId.SILENT_MAGE),
      Messages.gameOver('VILLAGE'),
    ].join('\n');
    expect(allText).not.toMatch(/xé xác|máu chảy|mày đã|ngươi sẽ phải chết/i);
    expect(allText).not.toContain('🧞');
    expect(allText).toContain('Màn đêm');
    expect(allText).toContain('ngôi làng');
  });
});
