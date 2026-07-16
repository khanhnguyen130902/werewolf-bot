import { RoleId, Team, DeathCause, WinnerTeam } from '../../engine/domain/enums';

/**
 * Centralized Vietnamese display strings, kept entirely separate from the
 * Game Engine (which only knows RoleId/Team/DeathCause enum values, never
 * display text). This module is the ONLY place natural-language strings
 * live, so a future localization pass (Suggestion #9: i18n layer) is a
 * matter of adding a sibling `messages.en.ts` and a locale switch, without
 * touching any engine or service code.
 */

export const RoleNames: Record<RoleId, string> = {
  [RoleId.WEREWOLF]: 'Sói',
  [RoleId.VILLAGER]: 'Dân thường',
  [RoleId.SEER]: 'Tiên tri',
  [RoleId.BODYGUARD]: 'Bảo vệ',
  [RoleId.HUNTER]: 'Thợ săn',
  [RoleId.WITCH]: 'Phù thủy',
};

export const RoleDescriptions: Record<RoleId, string> = {
  [RoleId.WEREWOLF]:
    'Mỗi đêm, bạn cùng các Sói khác chọn 1 người để cắn chết. Bạn thắng khi số Sói còn sống ≥ số Dân còn sống.',
  [RoleId.VILLAGER]:
    'Bạn không có kỹ năng đặc biệt. Hãy dùng lý luận vào ban ngày để tìm ra Sói.',
  [RoleId.SEER]:
    'Mỗi đêm, bạn soi 1 người để biết họ thuộc phe Sói hay phe Dân.',
  [RoleId.BODYGUARD]:
    'Mỗi đêm, bạn chọn 1 người để bảo vệ khỏi bị Sói cắn chết.',
  [RoleId.HUNTER]:
    'Khi bạn chết (do Sói cắn hoặc bị dân làng xử tử), bạn được bắn trả 1 người trước khi rời cuộc chơi.',
  [RoleId.WITCH]:
    'Bạn có 1 bình thuốc cứu và 1 bình thuốc độc, mỗi loại chỉ dùng được 1 lần trong cả ván. Bạn có thể dùng cả 2 trong cùng 1 đêm nếu muốn.',
};

export const TeamNames: Record<Team, string> = {
  [Team.WEREWOLF]: 'phe Sói',
  [Team.VILLAGE]: 'phe Dân làng',
};

export const DeathCauseNames: Record<string, string> = {
  [DeathCause.WEREWOLF_KILL]: 'bị Sói cắn chết',
  [DeathCause.VOTE_EXECUTION]: 'bị dân làng treo cổ',
  [DeathCause.WITCH_POISON]: 'bị đầu độc',
  [DeathCause.HUNTER_SHOT]: 'bị Thợ săn bắn hạ',
};

export const WinnerNames: Record<string, string> = {
  [WinnerTeam.VILLAGE]: 'phe Dân làng',
  [WinnerTeam.WEREWOLF]: 'phe Sói',
  [WinnerTeam.NONE]: 'không ai',
};

export const Messages = {
  roomCreated: (roomId: string) => {
    const safeRoomId = String(roomId).replace(/^-/, '');
    return `🎮 Đã tạo phòng chơi Ma Sói!\n\nMọi người gõ /join để tham gia. Khi đủ người, Host gõ /startgame để bắt đầu.\n\nMã phòng: ${safeRoomId}`;
  },
  needDmFirst: (botUsername: string) =>
    `⚠️ Bạn cần nhắn /start cho bot ở tin nhắn riêng trước khi tham gia, để bot có thể gửi vai trò và hành động riêng cho bạn.\n\n👉 Nhấn vào đây: https://t.me/${botUsername}?start=join`,
  joined: (nickname: string, count: number) => `✅ ${nickname} đã tham gia! (${count} người chơi)`,
  alreadyJoined: () => `Bạn đã tham gia phòng này rồi.`,
  left: (nickname: string) => `👋 ${nickname} đã rời phòng.`,
  roomFull: () => `❌ Phòng đã đủ người chơi tối đa.`,
  roomLocked: () => `❌ Ván đang diễn ra, không thể tham gia lúc này.`,
  notEnoughPlayers: (current: number, min: number) =>
    `❌ Cần tối thiểu ${min} người chơi để bắt đầu (hiện có ${current}).`,
  notHost: () => `❌ Chỉ Host mới có thể thực hiện hành động này.`,
  gameStarting: (playerCount: number) =>  
    `🌙 Bắt đầu ván chơi với ${playerCount} người! Vai trò đã được gửi riêng cho từng người qua tin nhắn riêng. Đêm đầu tiên bắt đầu...`,
  roleDistributionSummary: (playerCount: number, roleCounts: Array<{ roleId: RoleId; count: number }>) => {
    const lines = roleCounts
      .map((entry) => `- ${RoleNames[entry.roleId]}: ${entry.count}`)
      .join('\n');
    return `📋 Phân bổ vai trò cho ván này (${playerCount} người):\n${lines}`;
  },
  roleAssigned: (roleId: RoleId) =>
    `🎭 Vai trò của bạn là: **${RoleNames[roleId]}**\n\n${RoleDescriptions[roleId]}`,
  nightBegins: (round: number) =>
    `🌙 Đêm ${round} bắt đầu. Những ai có hành động đêm, vui lòng thực hiện qua tin nhắn riêng.`,
  actionRecorded: () => `✅ Đã ghi nhận hành động của bạn.`,
  dayBegins: (round: number, deaths: Array<{ nickname: string; cause: string }>) => {
    if (deaths.length === 0) {
      return `☀️ Trời sáng rồi! Đêm ${round} không có ai thiệt mạng.`;
    }
    const lines = deaths
      .map((d) => `💀 ${d.nickname} đã ${DeathCauseNames[d.cause] ?? d.cause}.`)
      .join('\n');
    return `☀️ Trời sáng rồi!\n\n${lines}`;
  },
  discussionStarted: (seconds: number) =>
    `💬 Bắt đầu thảo luận trong ${seconds} giây. Hãy cùng bàn bạc xem ai là Sói!`,
  votingStarted: (seconds: number) =>
    `🗳 Bắt đầu bỏ phiếu trong ${seconds} giây. Chọn người bạn muốn treo cổ.`,
  voteRecorded: () => `✅ Đã ghi nhận phiếu bầu của bạn.`,
  targetSelected: (action: string, targetNickname: string | null) =>
    targetNickname
      ? `✅ ${action}: **${targetNickname}**.`
      : `✅ ${action}: **Bỏ qua**.`,
  executionResult: (nickname: string | null) =>
    nickname
      ? `⚖️ Dân làng đã quyết định treo cổ **${nickname}**.`
      : `⚖️ Không đạt đa số phiếu — không ai bị treo cổ hôm nay.`,
  hunterPrompt: (seconds: number) =>
    `🏹 Bạn là Thợ săn và vừa bị hạ! Bạn có ${seconds} giây để chọn 1 người bắn trả (hoặc bỏ qua).`,
  hunterShotResult: (hunterNickname: string, targetNickname: string) =>
    `🏹 ${hunterNickname} đã bắn trả và hạ gục ${targetNickname} trước khi ngã xuống!`,
  seerResult: (targetNickname: string, teamName: string) =>
    `🔮 Kết quả soi: **${targetNickname}** thuộc **${teamName}**.`,
  gameOver: (winner: string) =>
    `🏆 Ván đấu kết thúc! Chiến thắng thuộc về **${WinnerNames[winner] ?? winner}**!`,
  finalRoleSummary: (entries: Array<{ nickname: string; roleId: RoleId }>) => {
    const groupedByRole = entries.reduce<Record<RoleId, string[]>>((acc, entry) => {
      if (!acc[entry.roleId]) acc[entry.roleId] = [];
      acc[entry.roleId].push(entry.nickname);
      return acc;
    }, {} as Record<RoleId, string[]>);

    const roleSections = Object.entries(groupedByRole)
      .map(([roleId, nicknames]) => {
        const roleName = RoleNames[roleId as RoleId];
        const names = nicknames.join(' & ');
        return `• ${roleName}: ${names}`;
      })
      .join('\n');

    return `🎭 Vai trò sau ván:\n\n${roleSections}`;
  },
  werewolfTeammates: (teammates: string[]) => {
    if (teammates.length === 0) return '';
    return `🧠 Bạn là Sói. Những Sói khác trong ván là: ${teammates.join(', ')}.`;
  },
  hostKicked: (nickname: string) => `🚫 ${nickname} đã bị Host mời ra khỏi phòng.`,
  invalidTarget: () => `❌ Mục tiêu không hợp lệ. Vui lòng chọn lại.`,
  genericError: (message: string) => `❌ Đã xảy ra lỗi: ${message}`,
  actionTimeout: () => `⌛ Hết giờ! Hành động của bạn được coi là bỏ qua.`,
} as const;
