import { RoleId, Team, DeathCause, WinnerTeam } from '../../engine/domain/enums';

/ Player-facing Vietnamese text for the Telegram interface. */
export const RoleNames: Record<RoleId, string> = {
  [RoleId.WEREWOLF]: '🐺 Sói',
  [RoleId.VILLAGER]: '🧑‍🌾 Dân làng',
  [RoleId.SEER]: '🔮 Tiên tri',
  [RoleId.BODYGUARD]: '🛡️ Bảo vệ',
  [RoleId.HUNTER]: '🏹 Thợ săn',
  [RoleId.WITCH]: '🧙‍♂️ Phù thủy',
};

export const RoleDescriptions: Record<RoleId, string> = {
  [RoleId.WEREWOLF]:
    'Bóng tối là đồng minh của bạn. Mỗi đêm, bạn cùng bầy Sói lặng lẽ chọn ra một con mồi để xé toạc màn đêm. Phe Sói thắng khi số Sói còn sống ngang bằng hoặc vượt qua số người phe Dân - khi đó, làng sẽ thuộc về các người.',

  [RoleId.VILLAGER]:
    'Bạn chỉ có đôi mắt, khối óc và bản năng sinh tồn. Không phép thuật, không đặc quyền - chỉ có sự quan sát sắc bén, những cuộc tranh luận nảy lửa và một lá phiếu định mệnh để lôi Sói ra ánh sáng trước khi quá muộn.',

  [RoleId.SEER]:
    'Đôi mắt của bạn nhìn xuyên qua lớp mặt nạ con người. Mỗi đêm, hãy chọn một người để soi thấu bản chất thật của họ - Sói đội lốt, hay Dân làng vô tội.',

  [RoleId.BODYGUARD]:
    'Bạn là lá chắn cuối cùng đứng giữa bóng tối và sự sống. Mỗi đêm, hãy chọn một người để bảo vệ khỏi nanh vuốt của Sói - nhưng cẩn thận, không thể che chở cùng một người hai đêm liên tiếp.',

  [RoleId.HUNTER]:
    'Ngay cả khi gục ngã, bạn vẫn còn một viên đạn cuối cùng. Trước khi rời khỏi cuộc chơi, hãy chọn một người để kéo theo xuống vực - hoặc buông súng trong im lặng.',

  [RoleId.WITCH]:
    'Trong bóng tối căn nhà nhỏ, hai lọ thuốc chờ được định đoạt: một mang lại sự sống, một mang đến cái chết. Mỗi lọ chỉ dùng được một lần trong suốt ván chơi. Nếu cả hai vẫn còn nguyên, bạn có thể dùng một, dùng cả hai, hoặc cất chúng đi trong cùng một đêm.',
};

export const TeamNames: Record<Team, string> = {
  [Team.WEREWOLF]: '🐺 phe Sói',
  [Team.VILLAGE]: '🏘️ phe Dân làng',
};

export const DeathCauseNames: Record<string, string> = {
  [DeathCause.WEREWOLF_KILL]: 'bị bầy Sói xé xác trong đêm',
  [DeathCause.VOTE_EXECUTION]: 'bị dân làng treo cổ trên quảng trường',
  [DeathCause.WITCH_POISON]: 'trúng độc của Phù thủy và trút hơi thở cuối cùng',
  [DeathCause.HUNTER_SHOT]: 'ngã gục dưới phát súng cuối cùng của Thợ săn',
};

export const WinnerNames: Record<string, string> = {
  [WinnerTeam.VILLAGE]: '🏘️ phe Dân làng',
  [WinnerTeam.WEREWOLF]: '🐺 phe Sói',
  [WinnerTeam.NONE]: 'không một ai',
};

export const Messages = {
  groupOnly: (command: string) => `❌ ${command} chỉ có hiệu lực trong nhóm chat.`,

  roomClosed: () => '🛑 Phòng chơi đã khép lại. Một ván mới có thể được mở ra bất cứ lúc nào tại đây.',

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

  dayBegins: (round: number, deaths: Array<{ nickname: string; cause: string }>) =>
    deaths.length === 0
      ? `☀️ BÌNH MINH NGÀY ${round}\n\nMột đêm yên bình hiếm hoi - không ai phải trả giá bằng mạng sống.`
      : `☀️ BÌNH MINH NGÀY ${round}\n\nĐêm qua, bóng tối đã cướp đi những sinh mạng...\n\n${deaths.map((death) => `💀 ${death.nickname} ${DeathCauseNames[death.cause] ?? 'đã ra đi mãi mãi'}.`).join('\n')}`,

  discussionStarted: (seconds: number) => `💬 GIỜ TRANH LUẬN BẮT ĐẦU\n\nCác người có ${seconds} giây để lật tẩy dối trá, bảo vệ sự thật và tìm ra kẻ đang ẩn mình giữa các người.`,

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

  seerResult: (targetNickname: string, teamName: string) => `🔮 THỊ KIẾN HIỆN RA: ${targetNickname} thuộc về ${teamName}.`,

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