import { RoleId, Team, DeathCause, WinnerTeam } from '../../engine/domain/enums';

/** Player-facing Vietnamese text for the Telegram interface. */
export const RoleNames: Record<RoleId, string> = {
  [RoleId.WEREWOLF]: 'Sói',
  [RoleId.VILLAGER]: 'Dân làng',
  [RoleId.SEER]: 'Tiên tri',
  [RoleId.BODYGUARD]: 'Bảo vệ',
  [RoleId.HUNTER]: 'Thợ săn',
  [RoleId.WITCH]: 'Phù thủy',
};

export const RoleDescriptions: Record<RoleId, string> = {
  [RoleId.WEREWOLF]: 'Mỗi đêm, bạn cùng phe Sói chọn một người để hạ. Phe Sói thắng khi số Sói còn sống bằng hoặc nhiều hơn số Dân làng còn sống.',
  [RoleId.VILLAGER]: 'Bạn không có kỹ năng đặc biệt. Hãy quan sát, thảo luận và bỏ phiếu để tìm ra Sói.',
  [RoleId.SEER]: 'Mỗi đêm, bạn có thể soi một người để biết họ thuộc phe Sói hay phe Dân làng.',
  [RoleId.BODYGUARD]: 'Mỗi đêm, bạn có thể bảo vệ một người khỏi đòn tấn công của Sói.',
  [RoleId.HUNTER]: 'Khi bị hạ, bạn được chọn một người để bắn trả. Bạn cũng có thể bỏ qua.',
  [RoleId.WITCH]: 'Bạn có một bình thuốc cứu và một bình thuốc độc. Mỗi bình chỉ dùng được một lần trong cả ván; bạn có thể dùng cả hai trong cùng một đêm.',
};

export const TeamNames: Record<Team, string> = { [Team.WEREWOLF]: 'phe Sói', [Team.VILLAGE]: 'phe Dân làng' };
export const DeathCauseNames: Record<string, string> = {
  [DeathCause.WEREWOLF_KILL]: 'bị Sói hạ trong đêm',
  [DeathCause.VOTE_EXECUTION]: 'bị treo cổ sau cuộc bỏ phiếu',
  [DeathCause.WITCH_POISON]: 'trúng thuốc độc của Phù thủy',
  [DeathCause.HUNTER_SHOT]: 'bị Thợ săn bắn hạ',
};
export const WinnerNames: Record<string, string> = { [WinnerTeam.VILLAGE]: 'phe Dân làng', [WinnerTeam.WEREWOLF]: 'phe Sói', [WinnerTeam.NONE]: 'không bên nào' };

export const Messages = {
  groupOnly: (command: string) => `❌ ${command} chỉ dùng được trong nhóm.`,
  roomClosed: () => '🛑 Phòng đã bị đóng. Bạn có thể tạo ván mới trong nhóm này.',
  roomCreated: (roomId: string) => {
    const safeRoomId = String(roomId).replace(/^-/, '');
    return `🎮 Đã mở phòng Ma Sói.\n\nMọi người gõ /join để tham gia. Khi đã đủ người, chủ phòng gõ /startgame để bắt đầu.\n\nMã phòng: ${safeRoomId}`;
  },
  needDmFirst: (botUsername: string) => `⚠️ Hãy nhắn /start cho bot trong tin nhắn riêng trước, để bot có thể gửi vai trò và các lựa chọn ban đêm cho bạn.\n\n👉 https://t.me/${botUsername}?start=join`,
  joined: (nickname: string, count: number) => `✅ ${nickname} đã vào phòng. Hiện có ${count} người chơi.`,
  alreadyJoined: () => 'Bạn đã ở trong phòng này rồi.',
  left: (nickname: string) => `👋 ${nickname} đã rời phòng.`,
  roomFull: () => '❌ Phòng đã đủ người chơi.',
  roomLocked: () => '❌ Ván chơi đã bắt đầu nên không thể tham gia thêm.',
  notEnoughPlayers: (current: number, min: number) => `❌ Cần ít nhất ${min} người để bắt đầu; hiện mới có ${current} người.`,
  notHost: () => '❌ Chỉ chủ phòng mới có thể thực hiện việc này.',
  gameStarting: (playerCount: number) => `🌙 Ván Ma Sói với ${playerCount} người đã bắt đầu. Vai trò đã được gửi riêng; đêm đầu tiên bắt đầu ngay bây giờ.`,
  roleDistributionSummary: (playerCount: number, roleCounts: Array<{ roleId: RoleId; count: number }>) => `📋 Phân vai cho ${playerCount} người:\n${roleCounts.map((entry) => `• ${RoleNames[entry.roleId]}: ${entry.count}`).join('\n')}`,
  roleAssigned: (roleId: RoleId) => `🎭 Bạn là **${RoleNames[roleId]}**.\n\n${RoleDescriptions[roleId]}`,
  nightBegins: (round: number) => `🌙 Đêm ${round} bắt đầu. Những người có kỹ năng ban đêm hãy kiểm tra tin nhắn riêng và đưa ra lựa chọn.`,
  actionRecorded: () => '✅ Đã ghi nhận lựa chọn của bạn.',
  dayBegins: (round: number, deaths: Array<{ nickname: string; cause: string }>) => deaths.length === 0 ? `☀️ Trời sáng, ngày ${round} bắt đầu. Đêm qua không ai bị hạ.` : `☀️ Trời sáng, ngày ${round} bắt đầu.\n\n${deaths.map((death) => `💀 ${death.nickname} ${DeathCauseNames[death.cause] ?? 'đã chết'}.`).join('\n')}`,
  discussionStarted: (seconds: number) => `💬 Mọi người có ${seconds} giây để thảo luận. Hãy chia sẻ thông tin và tìm ra Sói.`,
  votingStarted: (seconds: number) => `🗳️ Bỏ phiếu bắt đầu. Bạn có ${seconds} giây để chọn người muốn treo cổ, hoặc chọn Bỏ qua.`,
  voteRecorded: () => '✅ Phiếu của bạn đã được ghi nhận.',
  voteAlreadyCast: () => '⚠️ Bạn đã bỏ phiếu trong lượt này nên không thể thay đổi.',
  targetSelected: (action: string, targetNickname: string | null) => targetNickname ? `✅ Đã ghi nhận lựa chọn ${action}: **${targetNickname}**.` : `✅ Bạn đã chọn bỏ qua ${action}.`,
  nightActionSkipped: (action: string) => `✅ Bạn đã chọn bỏ qua ${action}.`,
  executionResult: (nickname: string | null) => nickname ? `⚖️ Kết quả bỏ phiếu: **${nickname}** bị treo cổ.` : '⚖️ Kết quả bỏ phiếu: không ai bị treo cổ hôm nay.',
  executionRoleReveal: (nickname: string, roleId: RoleId) => `🎭 ${nickname} là **${RoleNames[roleId]}**.`,
  hunterPrompt: (seconds: number) => `🏹 Bạn là Thợ săn và vừa bị hạ. Bạn có ${seconds} giây để chọn một người bắn trả, hoặc bỏ qua.`,
  hunterShotResult: (hunterNickname: string, targetNickname: string) => `🏹 Trước khi ngã xuống, ${hunterNickname} đã bắn hạ ${targetNickname}.`,
  seerResult: (targetNickname: string, teamName: string) => `🔮 Kết quả soi: **${targetNickname}** thuộc **${teamName}**.`,
  gameOver: (winner: string) => `🏆 Ván chơi kết thúc. **${WinnerNames[winner] ?? winner}** chiến thắng!`,
  finalRoleSummary: (entries: Array<{ nickname: string; roleId: RoleId }>) => {
    const groupedByRole = entries.reduce<Record<RoleId, string[]>>((acc, entry) => { if (!acc[entry.roleId]) acc[entry.roleId] = []; acc[entry.roleId].push(entry.nickname); return acc; }, {} as Record<RoleId, string[]>);
    return `🎭 Vai trò của mọi người:\n\n${Object.entries(groupedByRole).map(([roleId, nicknames]) => `• ${RoleNames[roleId as RoleId]}: ${nicknames.join(', ')}`).join('\n')}`;
  },
  werewolfTeammates: (teammates: string[]) => teammates.length > 0 ? `🐺 Những Sói cùng phe với bạn: ${teammates.join(', ')}.` : '🐺 Bạn là Sói duy nhất trong ván này.',
  hostKicked: (nickname: string) => `🚫 ${nickname} đã bị chủ phòng mời ra khỏi phòng.`,
  invalidTarget: () => '❌ Mục tiêu không hợp lệ. Hãy chọn lại.',
  genericError: () => '❌ Có lỗi xảy ra. Vui lòng thử lại.',
  actionTimeout: () => '⌛ Hết giờ. Lựa chọn của bạn được tính là bỏ qua.',
} as const;