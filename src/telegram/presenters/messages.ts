import { RoleId, Team, DeathCause, WinnerTeam } from '../../engine/domain/enums';

/** Player-facing Vietnamese text for the Telegram interface. */
export const RoleNames: Record<RoleId, string> = {
  [RoleId.WEREWOLF]: '🐺 Sói',
  [RoleId.VILLAGER]: '🧑‍🌾 Dân làng',
  [RoleId.SEER]: '🔮 Tiên tri',
  [RoleId.BODYGUARD]: '🛡️ Bảo vệ',
  [RoleId.HUNTER]: '🏹 Thợ săn',
  [RoleId.WITCH]: '🧙‍♂️ Phù thủy',
  [RoleId.SILENT_MAGE]: '🧞 Pháp sư câm',
};

export const RoleDescriptions: Record<RoleId, string> = {
  [RoleId.WEREWOLF]:
    'Bạn thuộc phe Sói và hoạt động trong bóng tối.\n\n' +
    '🎯 Mỗi đêm: Cùng những con Sói khác chọn 1 người làm con mồi.\n' +
    '🏆 Thắng khi: Số Sói còn sống ≥ số người phe Dân.',

  [RoleId.VILLAGER]:
    'Bạn không có kỹ năng đặc biệt, nhưng có quyền quyết định số phận của cả ngôi làng.\n\n' +
    '🎯 Nhiệm vụ: Quan sát, tranh luận và tìm ra Sói.\n' +
    '🗳️ Mỗi ngày: Bỏ phiếu để loại người bạn nghi ngờ.\n' +
    '🏆 Thắng khi: Tất cả Sói bị loại.',

  [RoleId.SEER]:
    'Bạn có khả năng nhìn thấy thân phận thật của người khác.\n\n' +
    '🎯 Mỗi đêm: Chọn 1 người để kiểm tra phe.\n' +
    '👁️ Kết quả: Biết người đó thuộc phe Sói hay phe Dân.\n' +
    '🏆 Mục tiêu: Dùng thông tin có được để giúp phe Dân tìm ra Sói.',

  [RoleId.BODYGUARD]:
    'Bạn là người đứng giữa Sói và con mồi.\n\n' +
    '🎯 Mỗi đêm: Chọn 1 người để bảo vệ khỏi Sói.\n' +
    '⚠️ Giới hạn: Không thể bảo vệ cùng một người trong 2 đêm liên tiếp.\n' +
    '🏆 Mục tiêu: Giữ những nhân vật quan trọng của phe Dân sống sót.',

  [RoleId.HUNTER]:
    'Bạn luôn giữ lại một viên đạn cho thời khắc cuối cùng.\n\n' +
    '🎯 Khi bị loại: Có thể chọn 1 người khác để loại cùng.\n' +
    '⚠️ Lựa chọn: Bạn cũng có thể không sử dụng phát bắn cuối cùng.\n' +
    '🏆 Mục tiêu: Hạ Sói trước khi rời khỏi cuộc chơi.',

  [RoleId.WITCH]:
    'Bạn sở hữu 2 lọ thuốc, mỗi lọ chỉ được sử dụng 1 lần trong cả ván.\n\n' +
    '💚 Thuốc cứu: Cứu 1 người khỏi bị Sói tấn công.\n' +
    '💀 Thuốc độc: Loại 1 người khỏi cuộc chơi.\n\n' +
    '🌙 Mỗi đêm, bạn có thể:\n' +
    '• Dùng thuốc cứu\n' +
    '• Dùng thuốc độc\n' +
    '• Dùng cả 2\n' +
    '• Không dùng thuốc nào',

  [RoleId.SILENT_MAGE]:
    'Bạn điều khiển sự im lặng của bóng tối.\n\n' +
    '🎯 Mỗi đêm: Chọn 1 người còn sống để câm lặng trong ngày kế tiếp.\n' +
    '⚠️ Người đang bị câm mà vẫn nói trong giờ tranh luận sẽ bị loại.\n' +
    '🏆 Mục tiêu: Giúp phe Dân làng bóp nghẹt lời nói dối của phe Sói.',
}

export const TeamNames: Record<Team, string> = {
  [Team.WEREWOLF]: '🐺 Phe Sói',
  [Team.VILLAGE]: '🏘️ Phe Dân làng',
};

export const DeathCauseNames: Record<string, string> = {
  [DeathCause.WEREWOLF_KILL]: 'bị bầy Sói xé xác trong đêm',
  [DeathCause.VOTE_EXECUTION]: 'bị dân làng treo cổ trên quảng trường',
  [DeathCause.WITCH_POISON]: 'trúng độc của Phù thủy và trút hơi thở cuối cùng',
  [DeathCause.HUNTER_SHOT]: 'ngã gục dưới phát súng cuối cùng của Thợ săn',
  [DeathCause.SPOKEN_WHILE_SILENCED]: 'bị lời nói phá vỡ lời nguyền im lặng',
};

export const WinnerNames: Record<string, string> = {
  [WinnerTeam.VILLAGE]: '🏘️ phe Dân làng',
  [WinnerTeam.WEREWOLF]: '🐺 phe Sói',
  [WinnerTeam.NONE]: 'không một ai',
};

export const Messages = {
  groupOnly: (command: string) => `❌ ${command} chỉ có hiệu lực trong nhóm chat.`,

  roomClosed: () => '🛑 Phòng chơi đã khép lại. Một ván mới có thể được mở ra bất cứ lúc nào tại đây.',

  noActiveGame: () =>
    '👀 Hiện chưa có ván chơi nào đang diễn ra tại đây.\n\nGõ /create để mở một ván mới và triệu tập dân làng.',

  notInCurrentGame: () =>
    '🚫 Bạn không tham gia ván chơi hiện tại nên không thể bỏ phiếu.',

  roomCreated: (roomId: string) => {
    const safeRoomId = String(roomId).replace(/^-/, '');
    return `🌕 MỘT VÁN MA SÓI MỚI VỪA MỞ RA...\n\nBóng tối đang chờ đợi những kẻ dũng cảm. Gõ /join để bước chân vào ngôi làng. Khi đã đủ người, chủ phòng gõ /startgame để màn đêm buông xuống.\n\n🎫 Mã phòng: ${safeRoomId}`;
  },

  needDmFirst: (botUsername: string) =>
    `⚠️ Trước khi bước vào cuộc chơi, hãy nhắn /start cho bot trong tin nhắn riêng - đó là cách duy nhất để nhận vai trò bí mật và đưa ra quyết định trong đêm.\n\n👉 https://t.me/${botUsername}?start=join`,

  joined: (nickname: string, count: number) => `✨ ${nickname} đã bước vào ngôi làng. Hiện có ${count} người chơi đang chờ đợi số phận.`,

  alreadyJoined: () => 'Bạn đã có một chỗ đứng trong ngôi làng này rồi.',

  left: (nickname: string) => `🚪 ${nickname} đã rời khỏi ngôi làng, để lại một chỗ trống trong bóng tối.`,

  roomFull: () => '🔒 Ngôi làng đã chật kín người - không còn chỗ cho ai khác.',

  roomLocked: () => '🔒 Cánh cổng làng đã đóng lại. Ván chơi đã bắt đầu, không thể vào thêm.',

  notEnoughPlayers: (current: number, min: number) => `⏳ Cần ít nhất ${min} linh hồn để khởi động ván chơi; hiện mới có ${current} người sẵn sàng.`,

  notHost: () => '👑 Chỉ chủ phòng mới nắm quyền định đoạt điều này.',

  gameStarting: (playerCount: number) => `🌑 BÓNG TỐI BUÔNG XUỐNG.\n\n${playerCount} người chơi đã dấn thân vào cuộc chơi sinh tử. Vai trò bí mật đã được gửi đến từng người - đêm đầu tiên bắt đầu ngay bây giờ.`,

  roleDistributionSummary: (playerCount: number, roleCounts: Array<{ roleId: RoleId; count: number }>) =>
    `📜 DANH SÁCH PHÂN VAI - ${playerCount} người chơi:\n${roleCounts.map((entry) => `• ${RoleNames[entry.roleId]}: ${entry.count}`).join('\n')}`,

  roleAssigned: (roleId: RoleId) => `🎭 SỐ PHẬN CỦA BẠN ĐÃ ĐƯỢC ĐỊNH ĐOẠT\n\nBạn là ${RoleNames[roleId]}.\n\n${RoleDescriptions[roleId]}`,

  nightBegins: (round: number) => `🌙 ĐÊM THỨ ${round} BUÔNG XUỐNG\n\nNhững kẻ mang sức mạnh bóng tối, hãy mở tin nhắn riêng và đưa ra lựa chọn của mình. Mỗi quyết định có thể định đoạt cả sinh mạng.`,

  actionRecorded: () => '🌒 Lựa chọn của bạn đã chìm vào bóng tối và được ghi nhận.',

  dayBegins: (round: number, deaths: Array<{ nickname: string }>, silencedNickname: string | null = null) => {
    const base = deaths.length === 0
      ? `☀️ BÌNH MINH NGÀY ${round}\n\nMột đêm yên bình hiếm hoi - không ai phải trả giá bằng mạng sống.`
      : `☀️ BÌNH MINH NGÀY ${round}\n\n💀 Người đã ra đi đêm qua: ${deaths.map((death) => death.nickname).join(', ')}`;
    return silencedNickname
      ? `${base}\n\n🗣️ ${silencedNickname} đã bị Pháp sư câm khóa lời trong ngày hôm nay. Hãy cẩn thận với mọi âm thanh!`
      : base;
  },

  discussionStarted: (seconds: number) => `💬 GIỜ TRANH LUẬN BẮT ĐẦU\n\nCác người có ${seconds} giây để lật tẩy dối trá, bảo vệ sự thật và tìm ra kẻ đang ẩn mình giữa các người.`,

  speechViolation: (nickname: string) => `🤐 ${nickname} đã phá vỡ lời nguyền im lặng và bị loại khỏi cuộc chơi.`,

  votingStarted: (seconds: number) => `🗳️ GIỜ PHÁN QUYẾT ĐÃ ĐIỂM\n\nBạn có ${seconds} giây để chỉ tay vào kẻ mình nghi ngờ nhất, hoặc chọn Bỏ qua nếu chưa đủ chắc chắn. Một lá phiếu sai có thể là bản án tử cho chính phe mình.`,

  voteRecorded: () => '🗳️ Phán quyết của bạn đã được khắc ghi.',

  voteAlreadyCast: () => '⚠️ Các người đã đưa ra phán quyết rồi - không thể đổi ý giữa chừng.',

  targetSelected: (action: string, targetNickname: string | null) =>
    targetNickname
      ? `✅ Quyết định ${action} đã được ghi nhận: ${targetNickname}`
      : `✅ Bạn đã chọn án binh bất động, bỏ qua ${action} đêm nay.`,

  nightActionSkipped: (action: string) => `✅ Bạn đã chọn án binh bất động, bỏ qua ${action} đêm nay.`,

  executionResult: (nickname: string | null) =>
    nickname
      ? `⚖️ PHÁN QUYẾT CUỐI CÙNG: ${nickname} bị treo cổ giữa quảng trường, dưới ánh mắt của cả ngôi làng.`
      : '⚖️ PHÁN QUYẾT CUỐI CÙNG: Ngôi làng chưa đủ dũng khí để định đoạt - không ai phải chết hôm nay.',

  executionRoleReveal: (nickname: string, roleId: RoleId) => `🎭 SỰ THẬT PHƠI BÀY: ${nickname} chính là ${RoleNames[roleId]}.`,

  hunterPrompt: (seconds: number) => `🏹 VIÊN ĐẠN CUỐI CÙNG\n\nBạn là Thợ săn và vừa gục ngã. Bạn còn ${seconds} giây để bóp cò lần cuối, kéo theo một kẻ khác - hoặc buông súng trong im lặng.`,

  hunterShotResult: (hunterNickname: string, targetNickname: string) => `🏹 Trong hơi thở cuối cùng, ${hunterNickname} đã siết cò, hạ gục ${targetNickname} cùng mình.`,

  seerResult: (targetNickname: string, teamName: string) =>
    `🔮 Ánh mắt tiên tri đã xuyên thấu ${targetNickname}.\n\nPhe: ${teamName}`,

  gameOver: (winner: string) => `🏆 MÀN ĐÊM ĐÃ KẾT THÚC\n\n${WinnerNames[winner] ?? winner} đã giành chiến thắng tuyệt đối!`,

  finalRoleSummary: (entries: Array<{ nickname: string; roleId: RoleId }>) => {
    const groupedByRole = entries.reduce<Record<RoleId, string[]>>((acc, entry) => {
      if (!acc[entry.roleId]) acc[entry.roleId] = [];
      acc[entry.roleId].push(entry.nickname);
      return acc;
    }, {} as Record<RoleId, string[]>);
    return `🎭 MÀN CHE ĐƯỢC VÉN LÊN - DANH TÍNH THẬT SỰ:\n\n${Object.entries(groupedByRole)
      .map(([roleId, nicknames]) => `• ${RoleNames[roleId as RoleId]}: ${nicknames.join(', ')}`)
      .join('\n')}`;
  },

  werewolfTeammates: (teammates: string[]) =>
    teammates.length > 0
      ? `🐺 Những kẻ săn mồi cùng bầy với bạn: ${teammates.join(', ')}. Hãy phối hợp, và đừng để lộ sơ hở.`
      : '🐺 Bạn là con Sói cô độc duy nhất trong đêm nay - mọi quyết định đều nằm trong tay bạn.',

  werewolfNoConsensusNotice: () =>
    `🐺 [THÔNG BÁO PHE SÓI]\nĐêm nay, phe Sói đã không đạt được sự đồng thuận về mục tiêu cắn.\n➡️ Do đó, phe Sói sẽ KHÔNG cắn ai trong đêm nay.`,

  hostKicked: (nickname: string) => `🚫 ${nickname} đã bị chủ phòng trục xuất khỏi ngôi làng.`,

  invalidTarget: () => '❌ Mục tiêu không tồn tại hoặc không hợp lệ. Hãy chọn lại.',

  genericError: () => '⚠️ Một điều gì đó đã đi sai hướng trong bóng tối. Vui lòng thử lại.',

  actionTimeout: () => '⌛ Thời gian đã cạn. Sự im lặng của bạn được tính là một lựa chọn bỏ qua.',
} as const;
