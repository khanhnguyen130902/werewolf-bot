import { RoleId, Team, DeathCause, WinnerTeam } from '../../engine/domain/enums';
import { CANONICAL_MESSAGES, ROLE_DISPLAY_NAMES, ROLE_EMOJIS } from './canonicalContent';

/** Canonical player-facing Vietnamese text for the Telegram interface. */
const roleLabel = (roleId: RoleId): string => `${ROLE_EMOJIS[roleId]} ${ROLE_DISPLAY_NAMES[roleId]}`;

export const RoleNames: Record<RoleId, string> = {
  [RoleId.WEREWOLF]: roleLabel(RoleId.WEREWOLF),
  [RoleId.VILLAGER]: roleLabel(RoleId.VILLAGER),
  [RoleId.SEER]: roleLabel(RoleId.SEER),
  [RoleId.BODYGUARD]: roleLabel(RoleId.BODYGUARD),
  [RoleId.HUNTER]: roleLabel(RoleId.HUNTER),
  [RoleId.WITCH]: roleLabel(RoleId.WITCH),
  [RoleId.SILENT_MAGE]: roleLabel(RoleId.SILENT_MAGE),
};

export const RoleDescriptions: Record<RoleId, string> = {
  [RoleId.WEREWOLF]:
    'Đêm xuống. Bóng tối đang đứng về phía bạn.\n\n' +
    '🎯 Mỗi đêm: Cùng những con Sói khác chọn 1 người còn sống làm mục tiêu tấn công.\n' +
    '🏆 Thắng khi: Điều kiện chiến thắng của phe Sói được thỏa mãn.',

  [RoleId.VILLAGER]:
    'Bạn không có sức mạnh đặc biệt. Nhưng trong ngôi làng này, một lá phiếu đúng có thể thay đổi tất cả.\n\n' +
    '🎯 Nhiệm vụ: Quan sát, thảo luận và tìm ra Sói.\n' +
    '🗳️ Mỗi ngày: Bỏ phiếu theo luật của ván.\n' +
    '🏆 Thắng khi: Điều kiện chiến thắng của phe Dân được thỏa mãn.',

  [RoleId.SEER]:
    'Có những điều người khác không nhìn thấy. Bạn có thể nhìn sâu hơn vào một người trong đêm.\n\n' +
    '🎯 Mỗi đêm: Chọn 1 người còn sống để điều tra.\n' +
    '🔮 Kết quả: Nhận thông tin theo đúng kết quả mà ván quy định.\n' +
    '🏆 Mục tiêu: Dùng thông tin ấy để giúp phe Dân tìm ra Sói.',

  [RoleId.BODYGUARD]:
    'Khi cả ngôi làng ngủ, bạn vẫn còn thức.\n\n' +
    '🎯 Mỗi đêm: Chọn 1 người còn sống để bảo vệ khỏi đòn tấn công phù hợp.\n' +
    '⚠️ Giới hạn: Các quy tắc tự bảo vệ và bảo vệ liên tiếp được áp dụng theo trạng thái ván.\n' +
    '🏆 Mục tiêu: Giữ những người quan trọng của phe Dân sống sót.',

  [RoleId.HUNTER]:
    'Bạn luôn giữ lại một viên đạn cho thời khắc cuối cùng.\n\n' +
    '🎯 Khi luật tử vong cho phép: Chọn 1 người còn sống để bắn trả.\n' +
    '⚠️ Lựa chọn: Bạn có thể không sử dụng phát bắn cuối cùng.\n' +
    '🏆 Mục tiêu: Góp phần đưa phe Dân đến chiến thắng.',

  [RoleId.WITCH]:
    'Hai lọ thuốc nằm im trong bóng tối. Mỗi lọ chỉ có thể được dùng một lần trong ván.\n\n' +
    '🧪 Thuốc cứu: Cứu mục tiêu theo luật của ván.\n' +
    '☠️ Thuốc độc: Chọn 1 mục tiêu hợp lệ để đầu độc.\n' +
    '🌙 Mỗi đêm: Bạn có thể dùng thuốc theo số lần và điều kiện còn lại trong trạng thái ván.',

  [RoleId.SILENT_MAGE]:
    'Bạn không cần nói lớn để thay đổi bầu không khí của cả ngôi làng.\n\n' +
    '🎯 Mỗi đêm: Chọn 1 người còn sống để làm câm theo chu kỳ được cấu hình.\n' +
    '⚠️ Hiệu ứng và xử lý khi người bị câm lên tiếng tuân theo luật của ván.\n' +
    '🏆 Mục tiêu: Giúp phe Dân hạn chế những lời nói dối nguy hiểm.',
};

export const TeamNames: Record<Team, string> = {
  [Team.WEREWOLF]: '🐺 Phe Sói',
  [Team.VILLAGE]: '🏘️ Phe Dân',
};

export const DeathCauseNames: Record<string, string> = {
  [DeathCause.WEREWOLF_KILL]: 'không còn thức dậy sau một đêm dài',
  [DeathCause.VOTE_EXECUTION]: 'rời khỏi cuộc chơi sau phán quyết của ngôi làng',
  [DeathCause.WITCH_POISON]: 'gục xuống sau khi trúng độc',
  [DeathCause.HUNTER_SHOT]: 'ngã xuống sau phát bắn cuối cùng của Thợ săn',
  [DeathCause.SPOKEN_WHILE_SILENCED]: 'bị xử lý sau khi phá vỡ hiệu ứng im lặng',
};

export const WinnerNames: Record<string, string> = {
  [WinnerTeam.VILLAGE]: '🏘️ phe Dân',
  [WinnerTeam.WEREWOLF]: '🐺 phe Sói',
  [WinnerTeam.NONE]: 'không một phe nào',
};

export const Messages = {
  groupOnly: (command: string) => `❌ Chỉ dùng trong group. ${command} không có hiệu lực trong tin nhắn riêng.`,

  roomClosed: () => '🛑 Cánh cửa phòng đã khép lại. Bạn có thể mở một ván mới tại đây khi sẵn sàng.',

  noActiveGame: () =>
    '👀 Hiện chưa có ván chơi nào.\n\nGõ /create để mở một phòng mới cho ngôi làng.',

  notInCurrentGame: () =>
    '⚠️ Bạn chưa ở trong ván hiện tại. Vì vậy, bạn chưa thể bỏ phiếu.',

  roomCreated: (roomId: string) => {
    const safeRoomId = String(roomId).replace(/^-/, '');
    return `🌑 Một ván mới sắp bắt đầu.\n\nNgôi làng đang chờ người chơi tập hợp. Gõ /join để tham gia; khi đủ người, host dùng /startgame.\n\n🎫 Mã phòng: ${safeRoomId}`;
  },

  needDmFirst: (botUsername: string) =>
    `${CANONICAL_MESSAGES.DM_REQUIRED.text}\n\n👉 https://t.me/${botUsername}?start=join`,

  joined: (nickname: string, count: number) => `✨ ${nickname} đã vào làng. Hiện có ${count} người chơi đang chờ đêm xuống.`,

  alreadyJoined: () => '🌙 Bạn đã ở trong phòng này rồi. Ngôi làng đã ghi nhận tên bạn.',

  left: (nickname: string) => `🚪 ${nickname} đã rời phòng. Một chỗ trống vừa xuất hiện trong màn đêm.`,

  roomFull: () => '🔒 Phòng đã đủ người. Hiện không thể nhận thêm người chơi.',

  roomLocked: () => '🔒 Cánh cửa làng đã đóng. Ván chơi đã bắt đầu, không thể tham gia thêm.',

  notEnoughPlayers: (current: number, min: number) => `⏳ Chưa đủ người để bắt đầu. Hiện có ${current}; cần ít nhất ${min} người.`,

  notHost: () => '⚠️ Chỉ host mới có quyền thực hiện việc này.',

  gameStarting: (playerCount: number) => `🌑 Mọi người đã vào vị trí.\n\n${playerCount} người chơi chuẩn bị bước vào ván. Vai trò riêng sẽ được gửi qua DM; hãy kiểm tra tin nhắn của bạn.`,

  roleDistributionSummary: (playerCount: number, roleCounts: Array<{ roleId: RoleId; count: number }>) =>
    `🎭 Phân vai — ${playerCount} người chơi\n${roleCounts.map((entry) => `• ${RoleNames[entry.roleId]}: ${entry.count}`).join('\n')}`,

  roleAssigned: (roleId: RoleId) => `🎭 Vai trò của bạn đã được xác định.\n\nBạn là ${RoleNames[roleId]}.\n\n${RoleDescriptions[roleId]}`,

  nightBegins: (round: number) => `🌙 Đêm ${round} bắt đầu.\n\nNgôi làng chìm vào im lặng. Nếu role của bạn có hành động, hãy mở tin nhắn riêng và lựa chọn.`,

  nightActionPrompt: (round: number, roleId: RoleId, actionLabel: string) =>
    roleId === RoleId.WEREWOLF
      ? `🌙 Đêm ${round}. Bóng tối đang che giấu mọi thứ. Phe Sói hãy chọn một mục tiêu ${actionLabel.toLowerCase()} hợp lệ.`
      : `🌙 Đêm ${round}. Bạn là ${RoleNames[roleId]}. Hãy chọn hành động ${actionLabel.toLowerCase()} của mình.`,

  witchSavePrompt: (round: number, victimNickname: string) =>
    `🌙 Đêm ${round}. ${victimNickname} đang gặp nguy hiểm. Bạn có muốn dùng thuốc Cứu không?`,

  witchPoisonPrompt: (round: number) =>
    `🌙 Đêm ${round}. Một lọ thuốc Độc vẫn còn đó. Bạn có muốn sử dụng nó không?`,

  actionRecorded: () => '✅ Đã ghi nhận. Lựa chọn của bạn sẽ được xử lý theo luật của ván.',

  dayBegins: (round: number, deaths: Array<{ nickname: string }>, silencedNickname: string | null = null) => {
    const base = deaths.length === 0
      ? `☀️ Bình minh ngày ${round}.\n\nMột đêm yên bình đã trôi qua. Nhưng sự im lặng này chưa nói lên điều gì.`
      : `☀️ Bình minh ngày ${round}.\n\n💀 ${deaths.map((death) => `${death.nickname} đã chết`).join(', ')}. Ngôi làng mất đi một người trước khi trời sáng.`;
    return silencedNickname
      ? `${base}\n\n🤫 ${silencedNickname} đang chịu hiệu ứng im lặng trong ngày hôm nay.`
      : base;
  },

  discussionStarted: (seconds: number) => `💬 Giờ thảo luận bắt đầu.\n\nBạn có ${seconds} giây để lắng nghe, đặt câu hỏi và lần theo những dấu vết đáng ngờ.`,

  speechViolation: (nickname: string) => `⚠️ Hiệu ứng im lặng đã bị phá vỡ. ${nickname} bị xử lý theo luật của ván.`,

  votingStarted: (seconds: number) => `🗳️ Đã đến lúc lên tiếng.\n\nMọi ánh mắt đang hướng về nhau. Bạn có ${seconds} giây để chọn mục tiêu nghi ngờ, hoặc bỏ qua nếu luật cho phép.`,

  voteRecorded: () => '🗳️ Lá phiếu đã được ghi nhận. Không khí trong làng bỗng yên hơn.',

  voteAlreadyCast: () => '⚠️ Lá phiếu của bạn đã được ghi nhận. Bạn không thể thay đổi lựa chọn ở trạng thái hiện tại.',

  targetSelected: (action: string, targetNickname: string | null) =>
    targetNickname
      ? `✅ Đã ghi nhận hành động ${action}. Mục tiêu: ${targetNickname}.`
      : `✅ Đã ghi nhận bỏ qua. Bạn không thực hiện ${action} trong đêm nay.`,

  nightActionSkipped: (action: string) => `✅ Đã ghi nhận bỏ qua. Bạn không thực hiện ${action} trong đêm nay.`,

  executionResult: (nickname: string | null) =>
    nickname
      ? `⚖️ Phán quyết đã được đưa ra. ${nickname} đã chết và rời khỏi cuộc chơi.`
      : '⚖️ Chưa có phán quyết cuối cùng. Không ai chết trong lượt này.',

  executionRoleReveal: (nickname: string, roleId: RoleId) => `🎭 Vai trò được hé lộ: ${nickname} là ${RoleNames[roleId]}.`,

  hunterPrompt: (seconds: number) => `🏹 Thời khắc cuối cùng của Thợ săn.\n\nBạn còn ${seconds} giây để chọn một mục tiêu hợp lệ hoặc bỏ qua theo luật của ván.`,

  hunterShotResult: (hunterNickname: string, targetNickname: string) => `🏹 Phát bắn cuối cùng vang lên. ${hunterNickname} đã bắn trúng ${targetNickname}.`,

  seerResult: (targetNickname: string, teamName: string) => `🔮 Lá màn đã hé mở.\n\n${targetNickname} thuộc ${teamName}.`,

  gameOver: (winner: string) => `🏆 Câu chuyện của ngôi làng khép lại.\n\n${WinnerNames[winner] ?? winner} đã chiến thắng.`,

  finalRoleSummary: (entries: Array<{ nickname: string; roleId: RoleId }>) => {
    const groupedByRole = entries.reduce<Record<RoleId, string[]>>((acc, entry) => {
      if (!acc[entry.roleId]) acc[entry.roleId] = [];
      acc[entry.roleId].push(entry.nickname);
      return acc;
    }, {} as Record<RoleId, string[]>);
    return `🎭 Những bí mật được hé lộ.\n\n${Object.entries(groupedByRole)
      .map(([roleId, nicknames]) => `• ${RoleNames[roleId as RoleId]}: ${nicknames.join(', ')}`)
      .join('\n')}`;
  },

  werewolfTeammates: (teammates: string[]) =>
    teammates.length > 0
      ? `🐺 Bầy Sói của bạn: ${teammates.join(', ')}. Đêm nay, hãy phối hợp mà không để lộ dấu vết.`
      : '🐺 Bạn là con Sói duy nhất trong đêm nay. Mọi lựa chọn đều nằm trong tay bạn.',

  werewolfNoConsensusNotice: () =>
    '🐺 Phe Sói chưa đạt đồng thuận. Đêm nay, không có mục tiêu nào được chọn theo luật của ván.',

  hostKicked: (nickname: string) => `🚪 ${nickname} đã rời phòng theo quyết định của host.`,

  invalidTarget: () => CANONICAL_MESSAGES.INVALID_TARGET.text,

  genericError: () => '⚠️ Có điều gì đó vừa đi lệch khỏi bóng tối. Vui lòng thử lại.',

  actionTimeout: () => '⌛ Thời gian đã hết. Bot sẽ xử lý hành động theo luật của ván.',
} as const;
