import { RoleId, Team, DeathCause, WinnerTeam } from '../../engine/domain/enums';

/**
 * CANONICAL VIETNAMESE CONTENT — Werewolf Telegram Bot
 *
 * Nguồn định hướng: MANUS_MASTER_PROMPT (Dark Horror, Friendly Content Direction)
 * và CONTENT_STYLE_GUIDE.md / GAME_GLOSSARY.md / MESSAGE_CATALOG.md đi kèm.
 *
 * Nguyên tắc bất biến khi sửa file này:
 * 1. GAMEPLAY ACCURACY > ATMOSPHERE — không đổi rule/target logic để câu văn hay hơn.
 * 2. Chỉ random WORDING (variants), không random MEANING.
 * 3. Emoji dùng đúng bảng canonical trong CONTENT_STYLE_GUIDE.md, không đổi nghĩa emoji.
 * 4. Narrator là một giọng kể duy nhất: bí ẩn, điềm tĩnh, thân thiện — không đổi tone giữa các hàm.
 */

// ---------------------------------------------------------------------------
// Emoji mapping (canonical — không đổi tuỳ tiện cho cùng một concept)
// ---------------------------------------------------------------------------
const ROLE_EMOJIS: Record<RoleId, string> = {
  [RoleId.WEREWOLF]: '🐺',
  [RoleId.VILLAGER]: '🏘️',
  [RoleId.SEER]: '🔮',
  [RoleId.BODYGUARD]: '🛡️',
  [RoleId.HUNTER]: '🏹',
  [RoleId.WITCH]: '🧪',
  [RoleId.SILENT_MAGE]: '🤫',
};

const ROLE_DISPLAY_NAMES: Record<RoleId, string> = {
  [RoleId.WEREWOLF]: 'Sói',
  [RoleId.VILLAGER]: 'Dân làng',
  [RoleId.SEER]: 'Tiên tri',
  [RoleId.BODYGUARD]: 'Bảo vệ',
  [RoleId.HUNTER]: 'Thợ săn',
  [RoleId.WITCH]: 'Phù thủy',
  [RoleId.SILENT_MAGE]: 'Pháp sư câm',
};

const roleLabel = (roleId: RoleId): string => `${ROLE_EMOJIS[roleId]} ${ROLE_DISPLAY_NAMES[roleId]}`;

// ---------------------------------------------------------------------------
// Variant helper — chọn cách diễn đạt khác nhau, KHÔNG đổi nghĩa.
// Dùng seed (ví dụ round number) khi cần cùng 1 round luôn thấy cùng câu,
// nhưng khác round / khác ván sẽ đổi. Dùng random thuần khi không có seed hợp lý.
// ---------------------------------------------------------------------------
function pickVariant<T>(variants: readonly T[], seed?: number): T {
  if (variants.length === 1) return variants[0];
  const index = seed !== undefined
    ? Math.abs(seed) % variants.length
    : Math.floor(Math.random() * variants.length);
  return variants[index];
}

// ---------------------------------------------------------------------------
// Role content
// ---------------------------------------------------------------------------
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
    '🎯 Mỗi đêm: cùng những con Sói khác thống nhất chọn 1 người còn sống làm mục tiêu tấn công. Nếu không đồng thuận trước khi hết giờ, đêm đó không ai bị tấn công.\n' +
    '🏆 Thắng khi: số Sói còn sống ≥ số người phe Dân còn sống.',

  [RoleId.VILLAGER]:
    'Bạn không có sức mạnh đặc biệt. Nhưng trong ngôi làng này, một lá phiếu đúng lúc có thể thay đổi tất cả.\n\n' +
    '🎯 Nhiệm vụ: quan sát, lắng nghe và tìm ra ai đang nói dối.\n' +
    '🗳️ Mỗi ngày: bỏ phiếu (được phép bỏ phiếu trắng/skip).\n' +
    '🏆 Thắng khi: tất cả Sói đã bị loại khỏi ván.',

  [RoleId.SEER]:
    'Có những điều người khác không nhìn thấy. Bạn nhìn sâu hơn, mỗi đêm, vào một người.\n\n' +
    '🎯 Mỗi đêm: chọn 1 người còn sống để điều tra.\n' +
    '🔮 Kết quả: bạn chỉ biết phe của người đó (Phe Sói hay Phe Dân) — không biết chính xác họ là role gì.\n' +
    '🏆 Thắng khi: tất cả Sói đã bị loại khỏi ván.',

  [RoleId.BODYGUARD]:
    'Khi cả ngôi làng ngủ, bạn vẫn còn thức.\n\n' +
    '🎯 Mỗi đêm: chọn 1 người còn sống để bảo vệ khỏi đòn tấn công của Sói, kể cả chính bạn.\n' +
    '⚠️ Giới hạn: không được bảo vệ cùng một người ở 2 đêm liên tiếp.\n' +
    '🏆 Thắng khi: tất cả Sói đã bị loại khỏi ván.',

  [RoleId.HUNTER]:
    'Bạn luôn giữ lại một viên đạn cho thời khắc cuối cùng.\n\n' +
    '🎯 Khi bạn chết — vì bất kỳ nguyên nhân nào — bạn được chọn 1 người còn sống để bắn trả.\n' +
    '⚠️ Lựa chọn: bạn có thể không sử dụng phát bắn cuối cùng.\n' +
    '🏆 Thắng khi: tất cả Sói đã bị loại khỏi ván.',

  [RoleId.WITCH]:
    'Hai lọ thuốc nằm im trong bóng tối. Mỗi lọ chỉ được dùng một lần trong suốt ván.\n\n' +
    '🧪 Thuốc Cứu: cứu 1 người khỏi cái chết đêm đó — kể cả chính bạn.\n' +
    '☠️ Thuốc Độc: chọn 1 mục tiêu hợp lệ để đầu độc.\n' +
    '🌙 Bạn có thể dùng cả hai loại thuốc trong cùng một đêm, nếu cả hai vẫn còn.\n' +
    '🏆 Thắng khi: tất cả Sói đã bị loại khỏi ván.',

  [RoleId.SILENT_MAGE]:
    'Bạn không cần nói lớn để thay đổi không khí của cả ngôi làng.\n\n' +
    '🎯 Mỗi đêm: chọn 1 người còn sống để làm câm trong ngày hôm sau.\n' +
    '⚠️ Nếu người bị câm vẫn phát biểu trong giờ thảo luận, họ sẽ bị xử lý là chết ngay lập tức.\n' +
    '🏆 Thắng khi: tất cả Sói đã bị loại khỏi ván.',
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

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
export const Messages = {
  // --- LAYER 1 — PURE SYSTEM -----------------------------------------------

  groupOnly: (command: string) =>
    `❌ ${command} chỉ dùng được trong group, không có hiệu lực trong tin nhắn riêng.`,

  noActiveGame: () =>
    '👀 Hiện chưa có ván chơi nào ở đây.\n\nGõ /create để mở một phòng mới cho ngôi làng.',

  notInCurrentGame: () =>
    '⚠️ Bạn chưa ở trong ván hiện tại, nên chưa thể bỏ phiếu hay hành động.',

  roomFull: () => '🔒 Phòng đã đủ người. Hiện không thể nhận thêm ai nữa.',

  roomLocked: () => '🔒 Cánh cửa làng đã đóng — ván chơi đã bắt đầu, không thể tham gia thêm.',

  notEnoughPlayers: (current: number, min: number) =>
    `⏳ Chưa đủ người để bắt đầu. Hiện có ${current} người; cần ít nhất ${min} người.`,

  notHost: () => '⚠️ Chỉ host mới có quyền thực hiện việc này.',

  alreadyJoined: () => '🌙 Bạn đã ở trong phòng này rồi — ngôi làng đã ghi nhận tên bạn.',

  voteAlreadyCast: () =>
    '⚠️ Lá phiếu của bạn đã được ghi nhận. Bạn không thể đổi lựa chọn ở thời điểm này.',

  invalidTarget: () => '❌ Mục tiêu này không hợp lệ. Hãy chọn một người khác đang còn ở lại.',

  genericError: () => '⚠️ Có điều gì đó vừa đi lệch khỏi bóng tối. Vui lòng thử lại.',

  actionTimeout: () => '⌛ Thời gian đã hết — hệ thống sẽ tự động ghi nhận bạn bỏ qua hành động này.',

  nightActionSkipped: (action: string) =>
    `✅ Đã ghi nhận: bạn không thực hiện ${action} trong đêm nay.`,

  // --- LAYER 2 — GAMEPLAY (chút atmosphere) --------------------------------

  roomClosed: () => '🛑 Cánh cửa phòng đã khép lại. Mở một ván mới tại đây bất cứ khi nào sẵn sàng.',

  needDmFirst: (botUsername: string) =>
    `🔒 Bot cần nhắn tin riêng với bạn trước để gửi vai trò kín — hãy bấm vào đây rồi quay lại.\n\n👉 https://t.me/${botUsername}?start=join`,

  joined: (nickname: string, count: number) =>
    `✨ ${nickname} đã vào làng. Hiện có ${count} người đang chờ đêm xuống.`,

  left: (nickname: string) => `🚪 ${nickname} đã rời phòng. Một chỗ trống vừa xuất hiện trong màn đêm.`,

  hostKicked: (nickname: string) => `🚪 ${nickname} đã rời phòng theo quyết định của host.`,

  actionRecorded: () => '✅ Đã ghi nhận. Lựa chọn của bạn sẽ được xử lý khi đêm kết thúc.',

  witchSavePrompt: (round: number, victimNickname: string) =>
    `🧪 Đêm ${round}. ${victimNickname} đang gặp nguy hiểm — bạn có muốn dùng Thuốc Cứu không?`,

  witchPoisonPrompt: (round: number) =>
    `☠️ Đêm ${round}. Một lọ Thuốc Độc vẫn còn đó. Bạn có muốn sử dụng nó không?`,

  discussionStarted: (seconds: number) =>
    `💬 Giờ thảo luận bắt đầu. Bạn có ${seconds} giây để lắng nghe, đặt câu hỏi và lần theo những dấu vết đáng ngờ.`,

  speechViolation: (nickname: string) =>
    `🤫 Hiệu ứng im lặng vừa bị phá vỡ. ${nickname} bị xử lý là đã chết ngay lập tức.`,

  votingStarted: (seconds: number) =>
    `🗳️ Đã đến lúc lên tiếng. Mọi ánh mắt đang hướng về nhau — bạn có ${seconds} giây để chọn mục tiêu nghi ngờ, hoặc bỏ phiếu trắng.`,

  voteRecorded: () =>
    pickVariant([
      '🗳️ Lá phiếu đã được ghi nhận. Không khí trong làng bỗng lặng hơn.',
      '🗳️ Lá phiếu của bạn đã được đặt xuống. Không còn cách nào rút lại.',
    ] as const),

  targetSelected: (action: string, targetNickname: string | null) =>
    targetNickname
      ? `✅ Đã ghi nhận hành động ${action}. Mục tiêu: ${targetNickname}.`
      : `✅ Đã ghi nhận: bạn bỏ qua, không thực hiện ${action} trong đêm nay.`,

  hunterPrompt: (seconds: number) =>
    `🏹 Thời khắc cuối cùng của Thợ săn. Bạn còn ${seconds} giây để chọn một mục tiêu để bắn trả, hoặc bỏ qua — không bắn ai.`,

  seerResult: (targetNickname: string, teamName: string) =>
    `🔮 Lá màn đã hé mở.\n\n${targetNickname} thuộc ${teamName}.`,

  werewolfTeammates: (teammates: string[]) =>
    teammates.length > 0
      ? `🐺 Bầy Sói của bạn: ${teammates.join(', ')}. Hãy phối hợp mà không để lộ dấu vết.`
      : '🐺 Bạn là con Sói duy nhất trong đêm nay. Mọi lựa chọn đều nằm trong tay bạn.',

  werewolfNoConsensusNotice: () =>
    '🐺 Phe Sói chưa đạt đồng thuận. Đêm nay không có mục tiêu nào được chọn, theo luật của ván.',

  nightActionPrompt: (round: number, roleId: RoleId, actionLabel: string) =>
    roleId === RoleId.WEREWOLF
      ? `🐺 Đêm ${round}. Bóng tối đang che giấu mọi thứ — phe Sói hãy chọn một mục tiêu ${actionLabel.toLowerCase()} hợp lệ.`
      : `${ROLE_EMOJIS[roleId]} Đêm ${round}. Bạn là ${RoleNames[roleId]} — hãy chọn hành động ${actionLabel.toLowerCase()} của mình.`,

  // --- LAYER 3 — NARRATIVE --------------------------------------------------

  roomCreated: (roomId: string) => {
    const safeRoomId = String(roomId).replace(/^-/, '');
    return `🌑 Một ván mới sắp bắt đầu.\n\nNgôi làng đang chờ người tập hợp. Gõ /join để tham gia; khi đủ người, host dùng /startgame.\n\n🎫 Mã phòng: ${safeRoomId}`;
  },

  gameStarting: (playerCount: number) =>
    `🌑 Mọi người đã vào vị trí.\n\n${playerCount} người chuẩn bị bước vào ván. Vai trò riêng sẽ được gửi qua DM — hãy kiểm tra tin nhắn của bạn.`,

  roleDistributionSummary: (playerCount: number, roleCounts: Array<{ roleId: RoleId; count: number }>) =>
    `🎭 Phân vai — ${playerCount} người chơi\n${roleCounts.map((entry) => `• ${RoleNames[entry.roleId]}: ${entry.count}`).join('\n')}`,

  roleAssigned: (roleId: RoleId) =>
    `🎭 Vai trò của bạn đã được xác định.\n\nBạn là ${RoleNames[roleId]}.\n\n${RoleDescriptions[roleId]}`,

  nightBegins: (round: number) =>
    pickVariant(
      [
        `🌙 Đêm ${round} bắt đầu.\n\nNgôi làng chìm vào im lặng. Nếu vai trò của bạn có hành động, hãy mở tin nhắn riêng và lựa chọn.`,
        `🌙 Đêm ${round}.\n\nCả ngôi làng đã tắt đèn. Nhưng bóng tối chưa bao giờ thực sự yên tĩnh — hãy kiểm tra tin nhắn riêng nếu vai trò của bạn cần hành động.`,
        `🌙 Đêm ${round} lại đến.\n\nKhông ai biết điều gì sẽ xảy ra trước bình minh. Mở tin nhắn riêng nếu đến lượt bạn.`,
      ] as const,
      round,
    ),

  dayBegins: (round: number, deaths: Array<{ nickname: string }>, silencedNickname: string | null = null) => {
    const base = deaths.length === 0
      ? pickVariant(
          [
            `☀️ Bình minh ngày ${round}.\n\nMột đêm yên bình đã trôi qua. Nhưng sự im lặng ấy chưa nói lên điều gì.`,
            `☀️ Bình minh ngày ${round}.\n\nKhông ai rời khỏi ngôi làng đêm qua. Điều đó không có nghĩa là mọi thứ đã an toàn.`,
          ] as const,
          round,
        )
      : `☀️ Bình minh ngày ${round}.\n\n💀 ${deaths.map((death) => `${death.nickname} đã chết`).join(', ')}. Ngôi làng mất đi một người trước khi trời sáng.`;
    return silencedNickname
      ? `${base}\n\n🤫 ${silencedNickname} đang chịu hiệu ứng im lặng trong ngày hôm nay.`
      : base;
  },

  executionRoleReveal: (nickname: string, roleId: RoleId) =>
    `🎭 Vai trò được hé lộ: ${nickname} là ${RoleNames[roleId]}.`,

  finalRoleSummary: (entries: Array<{ nickname: string; roleId: RoleId }>) => {
    const groupedByRole = entries.reduce<Record<RoleId, string[]>>((acc, entry) => {
      if (!acc[entry.roleId]) acc[entry.roleId] = [];
      acc[entry.roleId].push(entry.nickname);
      return acc;
    }, {} as Record<RoleId, string[]>);
    return `🎭 Những bí mật cuối cùng được hé lộ.\n\n${Object.entries(groupedByRole)
      .map(([roleId, nicknames]) => `• ${RoleNames[roleId as RoleId]}: ${nicknames.join(', ')}`)
      .join('\n')}`;
  },

  // --- LAYER 4 — CLIMAX -------------------------------------------------------

  executionResult: (nickname: string | null) =>
    nickname
      ? pickVariant([
          `⚖️ Phán quyết đã được đưa ra.\n\n${nickname} đã chết và rời khỏi cuộc chơi.`,
          `⚖️ Ngôi làng đã lên tiếng.\n\n${nickname} không còn ở lại nữa.`,
        ] as const)
      : '⚖️ Chưa có phán quyết cuối cùng. Không ai chết trong lượt này.',

  hunterShotResult: (hunterNickname: string, targetNickname: string) =>
    `🏹 Phát bắn cuối cùng vang lên.\n\n${hunterNickname} đã bắn trúng ${targetNickname}.`,

  gameOver: (winner: string) => {
    if (winner === WinnerTeam.VILLAGE) {
      return pickVariant([
        `☀️ Bình minh cuối cùng cũng đến.\n\nNhững bóng tối còn sót lại đã biến mất.\n\n🏆 ${WinnerNames[winner]} chiến thắng.`,
        `☀️ Ngôi làng còn đứng vững.\n\nKhông còn con Sói nào lẩn khuất trong bóng tối nữa.\n\n🏆 ${WinnerNames[winner]} chiến thắng.`,
      ] as const);
    }
    if (winner === WinnerTeam.WEREWOLF) {
      return pickVariant([
        `🌑 Ngôi làng đã im tiếng.\n\nKhông còn ai đủ sức chống lại bóng tối.\n\n🏆 ${WinnerNames[winner]} chiến thắng.`,
        `🌑 Đêm cuối cùng đã nuốt trọn ngôi làng.\n\n🏆 ${WinnerNames[winner]} chiến thắng.`,
      ] as const);
    }
    return `🌑 Câu chuyện của ngôi làng khép lại.\n\n${WinnerNames[winner] ?? winner}.`;
  },
} as const;