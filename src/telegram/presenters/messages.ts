
import { RoleId, Team, DeathCause, WinnerTeam } from '../../engine/domain/enums';
import { CANONICAL_MESSAGES } from './canonicalContent';

/**
 * CANONICAL VIETNAMESE CONTENT — Werewolf Telegram Bot
 *
 * Tone:
 * - Dark Horror
 * - Cinematic
 * - Mysterious
 * - Calm
 * - Friendly
 *
 * Nguyên tắc:
 * 1. GAMEPLAY ACCURACY > ATMOSPHERE.
 * 2. Chỉ thay đổi WORDING, không thay đổi MEANING / RULE.
 * 3. Random chỉ thay đổi cách diễn đạt, không thay đổi nội dung.
 * 4. Narrator luôn giữ một giọng kể: điềm tĩnh, bí ẩn, hơi rùng rợn.
 * 5. Không dùng gore / mô tả bạo lực quá mức.
 */

// ---------------------------------------------------------------------------
// Emoji mapping
// ---------------------------------------------------------------------------

const ROLE_EMOJIS: Record<RoleId, string> = {
  [RoleId.WEREWOLF]: '🐺',
  [RoleId.VILLAGER]: '🧑‍🌾',
  [RoleId.SEER]: '🔮',
  [RoleId.BODYGUARD]: '🛡️',
  [RoleId.HUNTER]: '🏹',
  [RoleId.WITCH]: '🧙‍♂️',
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

const roleLabel = (roleId: RoleId): string =>
  `${ROLE_EMOJIS[roleId]} ${ROLE_DISPLAY_NAMES[roleId]}`;

// ---------------------------------------------------------------------------
// Variant helper
// ---------------------------------------------------------------------------

function pickVariant<T>(variants: readonly T[], seed?: number): T {
  if (variants.length === 1) return variants[0];

  const index =
    seed !== undefined
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
    'Trong đêm, hãy phối hợp với những con Sói khác để chọn 1 người còn sống làm mục tiêu tấn công. Nếu không đạt được đồng thuận trước khi hết giờ, đêm đó không ai bị tấn công.\n\n' +
    '🏆 Thắng khi: số Sói còn sống ≥ số người phe Dân còn sống.\n\n' +
    'Hãy phối hợp trong bóng tối. Đừng để lại dấu vết.',

  [RoleId.VILLAGER]:
    '🕯️ Bạn không sở hữu sức mạnh đặc biệt nào.\n\n' +
    'Nhưng giữa những lời nói dối, một ánh mắt đáng ngờ hay một lá phiếu đúng lúc có thể thay đổi số phận của cả ngôi làng.\n\n' +
    '🎯 Nhiệm vụ: quan sát, lắng nghe và tìm ra ai đang che giấu sự thật.\n' +
    '🗳️ Mỗi ngày: bỏ phiếu (được phép bỏ phiếu trắng/skip).\n' +
    '🏆 Thắng khi: tất cả Sói đã bị loại khỏi ván.',

  [RoleId.SEER]:
    '🔮 Có những điều người khác không thể nhìn thấy.\n\n' +
    'Còn bạn, mỗi đêm, có thể nhìn sâu hơn vào một người.\n\n' +
    '🎯 Mỗi đêm: chọn 1 người còn sống để điều tra.\n' +
    '🔮 Kết quả: bạn chỉ biết phe của người đó (Phe Sói hoặc Phe Dân) không biết chính xác họ là role gì.\n' +
    '🏆 Thắng khi: tất cả Sói đã bị loại khỏi ván.',

  [RoleId.BODYGUARD]:
    '🛡️ Khi cả ngôi làng chìm vào giấc ngủ, bạn vẫn còn thức.\n\n' +
    'Trong bóng tối, chỉ một quyết định của bạn cũng có thể giữ một người ở lại đến bình minh.\n\n' +
    '🎯 Mỗi đêm: chọn 1 người còn sống để bảo vệ khỏi đòn tấn công của Sói, kể cả chính bạn.\n' +
    '⚠️ Giới hạn: không được bảo vệ cùng một người ở 2 đêm liên tiếp.\n' +
    '🏆 Thắng khi: tất cả Sói đã bị loại khỏi ván.',

  [RoleId.HUNTER]:
    '🏹 Bạn luôn giữ lại một viên đạn cho thời khắc cuối cùng.\n\n' +
    '🎯 Khi bạn chết vì bất kỳ nguyên nhân nào bạn được chọn 1 người còn sống để bắn trả.\n' +
    '⚠️ Bạn có thể lựa chọn không sử dụng phát bắn cuối cùng.\n' +
    '🏆 Thắng khi: tất cả Sói đã bị loại khỏi ván.',

  [RoleId.WITCH]:
    'Trong bóng tối, hai lọ thuốc vẫn đang chờ được sử dụng. Mỗi lọ chỉ có một lần duy nhất và một khi đã dùng, sẽ không thể lấy lại.\n\n' +
    '🧪 Thuốc Cứu: cứu 1 người khỏi cái chết trong đêm kể cả chính bạn.\n' +
    '☠️ Thuốc Độc: chọn 1 mục tiêu hợp lệ để đầu độc.\n' +
    '🌙 Bạn có thể sử dụng cả hai loại thuốc trong cùng một đêm, nếu cả hai vẫn còn.\n\n' +
    '🏆 Thắng khi: tất cả Sói đã bị loại khỏi ván.',

  [RoleId.SILENT_MAGE]:
    '🤫 Bạn không cần nói lớn để khiến cả ngôi làng im lặng.\n\n' +
    '🎯 Mỗi đêm: chọn 1 người còn sống để làm câm trong ngày hôm sau.\n' +
    '⚠️ Nếu người bị câm vẫn phát biểu trong giờ thảo luận, họ sẽ bị xử lý là chết ngay lập tức.\n' +
    '🏆 Thắng khi: tất cả Sói đã bị loại khỏi ván.',
};

export const TeamNames: Record<Team, string> = {
  [Team.WEREWOLF]: '🐺 Phe Sói',
  [Team.VILLAGE]: '🧑‍🌾 Phe Dân',
};

export const DeathCauseNames: Record<string, string> = {
  [DeathCause.WEREWOLF_KILL]:
    'không còn thức dậy sau một đêm dài',

  [DeathCause.VOTE_EXECUTION]:
    'rời khỏi cuộc chơi sau phán quyết của ngôi làng',

  [DeathCause.WITCH_POISON]:
    'gục xuống sau khi trúng độc',

  [DeathCause.HUNTER_SHOT]:
    'ngã xuống sau phát bắn cuối cùng của Thợ săn',

  [DeathCause.SPOKEN_WHILE_SILENCED]:
    'bị xử lý sau khi phá vỡ hiệu ứng im lặng',
};

export const WinnerNames: Record<string, string> = {
  [WinnerTeam.VILLAGE]: '🧑‍🌾 phe Dân',
  [WinnerTeam.WEREWOLF]: '🐺 phe Sói',
  [WinnerTeam.NONE]: 'không một phe nào',
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const Messages = {
  // -------------------------------------------------------------------------
  // LAYER 1 — PURE SYSTEM
  // -------------------------------------------------------------------------

  groupOnly: (command: string) =>
    `❌ ${command} chỉ có hiệu lực trong group của ngôi làng.`,

  noActiveGame: () =>
    '👀 Ngôi làng vẫn đang yên ắng.\n\nChưa có ván chơi nào ở đây. Gõ /create để bắt đầu một câu chuyện mới.',

  notInCurrentGame: () => CANONICAL_MESSAGES.PLAYER_NOT_IN_GAME.text,

  roomFull: () =>
    '🔒 Ngôi làng đã đủ người.\n\nCánh cửa không thể đón thêm ai trong ván này.',

  roomLocked: () =>
    '🔒 Cánh cửa làng đã khép lại.\n\nVán chơi đã bắt đầu không thể có thêm người bước vào.',

  roomCreationLocked: () =>
    '⚠️ Nhóm này đang có một ván chơi diễn ra.\n\nKhông thể tạo phòng mới cho đến khi ván hiện tại kết thúc.',

  notEnoughPlayers: (current: number, min: number) =>
    `⏳ Ngôi làng vẫn còn quá ít người.\n\nHiện có ${current} người. Cần ít nhất ${min} người để màn đêm bắt đầu.`,

  notHost: () =>
    '⚠️ Chỉ người giữ quyền host mới có thể thực hiện hành động này.',

  alreadyJoined: () =>
    '🌙 Bạn đã có tên trong ngôi làng này rồi.\n\nMọi người đã ghi nhận sự có mặt của bạn.',

  voteAlreadyCast: () =>
    '⚠️ Lá phiếu của bạn đã được ghi nhận.\n\nQuyết định ấy không thể được thay đổi nữa.',

  invalidTarget: () =>
    '❌ Mục tiêu này không hợp lệ.\n\nHãy chọn một người vẫn còn ở lại trong ngôi làng.',

  genericError: () =>
    '⚠️ Có điều gì đó vừa đi lệch khỏi dự tính.\n\nHãy thử lại.',

  actionTimeout: () =>
    '⌛ Thời gian đã hết.\n\nHành động của bạn sẽ được ghi nhận là bỏ qua lượt này.',

  deathPrivateNotice: () =>
    '💀 Ván chơi của bạn đã kết thúc.\n\nBạn không thể tiếp tục hành động, bỏ phiếu hoặc phát biểu trong ván này.',

  nightActionSkipped: (action: string) =>
    `🌙 Đã ghi nhận.\n\nBạn không thực hiện ${action} trong đêm nay.`,

  // -------------------------------------------------------------------------
  // LAYER 2 — GAMEPLAY
  // -------------------------------------------------------------------------

  roomClosed: () =>
    '🛑 Câu chuyện của ván này dừng lại tại đây. Khi sẵn sàng, hãy mở một ván mới.',

  needDmFirst: (botUsername: string) =>
    `🔒 Vai trò của bạn cần được gửi trong tin nhắn riêng.\n\nHãy mở cuộc trò chuyện với Quản trò rồi quay lại ngôi làng.\n\n👉 https://t.me/${botUsername}?start=join`,

  joined: (nickname: string, count: number) =>
    `✨ ${nickname} đã bước vào ngôi làng.\n\n${count} người đã tập hợp.\nChỉ còn chờ màn đêm buông xuống.`,

  left: (nickname: string) =>
    `🚪 ${nickname} đã rời khỏi ngôi làng. Một vị trí vừa trở nên trống vắng.`,

  hostKicked: (nickname: string) =>
    `🚪 ${nickname} đã rời khỏi ngôi làng theo quyết định của host.`,

  actionRecorded: () =>
    '✅ Lựa chọn đã được ghi nhận.\n\nQuản trò sẽ xử lý hành động này khi đêm kết thúc.',

  witchSavePrompt: (round: number, victimNickname: string) =>
    `🧪 Đêm ${round}.\n\n${victimNickname} đang đứng trước ranh giới giữa sống và chết.\n\nBạn có muốn dùng Thuốc Cứu không?`,

  witchPoisonPrompt: (round: number) =>
    `☠️ Đêm ${round}.\n\nMột lọ Thuốc Độc vẫn còn trong tay bạn.\n\nBạn có muốn sử dụng nó không?`,

  discussionStarted: (seconds: number) =>
    `💬 Giờ thảo luận bắt đầu.\n\n${seconds} giây để lắng nghe từng lời nói, đặt câu hỏi và tìm kiếm những dấu hiệu đáng ngờ.\n\nTrong ngôi làng này, không phải lời nói nào cũng là sự thật.`,

  speechViolation: (nickname: string) =>
    `🤫 Sự im lặng đã bị phá vỡ.\n\n${nickname} đã lên tiếng khi đang chịu hiệu ứng im lặng và bị xử lý là đã chết.`,

  votingStarted: (seconds: number) =>
    `🗳️ Đã đến lúc đưa ra phán quyết.\n\nMọi ánh mắt đang hướng về nhau. Bạn có ${seconds} giây để chọn người mình nghi ngờ, hoặc bỏ phiếu trắng.`,

  voteRecorded: () =>
    pickVariant(
      [
        '🗳️ Lá phiếu đã được ghi nhận.\n\nMột quyết định nữa vừa được đặt xuống bàn cân.',
        '🗳️ Lá phiếu của bạn đã được đặt xuống.\n\nTừ giờ, quyết định ấy không thể được rút lại.',
      ] as const,
    ),

  targetSelected: (action: string, targetNickname: string | null) =>
    targetNickname
      ? `✅ Đã ghi nhận ${action}.\n\n🎯 Mục tiêu: ${targetNickname}.`
      : `🌙 Đã ghi nhận.\n\nBạn bỏ qua ${action} trong đêm nay.`,

  silentMageTargetSelected: (targetNickname: string) =>
    `🗣️ Lời nguyền im lặng đã được đặt xuống.\n\n🎯 ${targetNickname} sẽ không được lên tiếng trong ngày mai.`,

  bodyguardTargetSelected: (targetNickname: string) =>
    `🛡️ Lá chắn đã được dựng lên trong bóng tối.\n\n🎯 ${targetNickname} sẽ được bạn bảo vệ trong đêm nay.`,

  witchSaveTargetSelected: (targetNickname: string) =>
    `🧪 Lời cứu đã được trao.\n\n🎯 ${targetNickname} sẽ được bạn kéo trở lại từ ranh giới của cái chết trong đêm nay.`,

  witchPoisonTargetSelected: (targetNickname: string) =>
    `☠️ Một giọt độc đã được định đoạt cho đêm nay.\n\n🎯 ${targetNickname} là người bạn chọn làm mục tiêu.`,

  hunterPrompt: (round: number) =>
    `🌙 Đêm ${round}.\n\nBạn là 🏹 Thợ săn.\n\nKhi thời khắc cuối cùng đến, hãy chọn mục tiêu cho phát bắn của mình, hoặc hạ vũ khí và không bắn ai.`,

  seerResult: (targetNickname: string, teamName: string) => {
    const displayTeamName = TeamNames[teamName as Team] ?? teamName;
    return `🔮 Màn đêm đã hé lộ một phần sự thật.\n\n${targetNickname} thuộc ${displayTeamName}.\n\nNhưng trong ngôi làng này, sự thật hiếm khi chỉ có một mặt.`;
  },

  werewolfTeammates: (teammates: string[]) =>
    teammates.length > 0
      ? `🐺 Bầy Sói của bạn: ${teammates.join(', ')}.\n\nHãy phối hợp trong bóng tối và đừng để lại dấu vết.`
      : '🐺 Bạn là con Sói duy nhất trong đêm nay.\n\nMọi quyết định đều nằm trong tay bạn.',

  werewolfNoConsensusNotice: () =>
    '🐺 Bầy Sói đã không thể thống nhất mục tiêu.\n\nTheo luật của ván, đêm nay không ai bị tấn công.',

  nightActionPrompt: (
    round: number,
    roleId: RoleId,
    actionLabel: string,
  ) =>
    roleId === RoleId.WEREWOLF
      ? `🌙 Đêm ${round}. Bóng tối đã che giấu mọi dấu vết.\n\nBầy Sói, hãy chọn người sẽ trở thành mục tiêu trong đêm nay.`
      : roleId === RoleId.SILENT_MAGE
        ? `🌙 Đêm ${round}.\n\nBạn là 🤫 Pháp sư câm.\n\nTrong bóng tối, một người sẽ phải im lặng khi bình minh đến.\nHãy chọn mục tiêu của bạn.`
        : roleId === RoleId.BODYGUARD
          ? `🌙 Đêm ${round}.\n\nBạn là 🛡️ Bảo vệ.\n\n🛡️ Khi cả ngôi làng chìm vào giấc ngủ, bạn vẫn còn thức.\n\nĐêm nay, hãy chọn người bạn muốn bảo vệ.`
          : roleId === RoleId.SEER
            ? `🌙 Đêm ${round}.\n\nBạn là 🔮 Tiên tri.\n\nMàn đêm che giấu nhiều điều.\nNhưng không phải bí mật nào cũng có thể giữ kín mãi.\n\nĐêm nay, hãy chọn một người để khám phá phe của họ.`
            : `🌙 Đêm ${round}. Bạn là ${RoleNames[roleId]}. Đã đến lúc thực hiện ${actionLabel.toLowerCase()} của mình.`,

  // -------------------------------------------------------------------------
  // LAYER 3 — NARRATIVE
  // -------------------------------------------------------------------------

  roomCreated: (roomId: string) => {
    const safeRoomId = String(roomId).replace(/^-/, '');

    return (
      `🌑 Một đêm mới đang chờ đợi.\n\n` +
      `Cánh cửa ngôi làng đã mở.\n` +
      `Những người cuối cùng vẫn đang lần lượt bước vào, nhưng không ai biết ai sẽ đứng về phía mình.\n\n` +
      `Gõ /join để tham gia.\n` +
      `Khi đủ người, host dùng /startgame để khép cửa và bắt đầu ván chơi.\n\n` +
      `🎫 Mã phòng: ${safeRoomId}`
    );
  },

  gameStarting: (playerCount: number) =>
    `🌑 Cánh cửa ngôi làng sắp khép lại.\n\n${playerCount} người đã sẵn sàng bước vào đêm nay.\n\n🎭 Vai trò của mỗi người đã được định đoạt và sẽ được gửi qua tin nhắn riêng.\n\nHãy kiểm tra tin nhắn riêng của bạn trước khi màn đêm buông xuống.`,

  roleDistributionSummary: (
    playerCount: number,
    roleCounts: Array<{ roleId: RoleId; count: number }>,
  ) =>
    `🎭 Những vai trò đã được định đoạt: ${playerCount} người chơi\n\n${roleCounts
      .map(
        (entry) =>
          `• ${RoleNames[entry.roleId]}: ${entry.count}`,
      )
      .join('\n')}`,

  roleAssigned: (roleId: RoleId, teammates: string[] = []) => {
    const roleLine = roleId === RoleId.WEREWOLF
      ? `Bạn là ${RoleNames[roleId]}.  Lần này, bóng tối đứng về phía bạn.`
      : `Bạn là ${RoleNames[roleId]}.`;
    const teammateLine = roleId === RoleId.WEREWOLF && teammates.length > 0
      ? `\n\n🐺 Bầy Sói của bạn: ${teammates.join(', ')}.`
      : '';

    return `🎭 Một vai trò đã được trao cho bạn.\n\n${roleLine}${teammateLine}\n\n${RoleDescriptions[roleId]}`;
  },

  nightBegins: (round: number) =>
    pickVariant(
      [
        `🌙 Đêm ${round} bắt đầu.\n\nNgôi làng chìm vào im lặng.\nNếu vai trò của bạn có hành động, hãy mở tin nhắn riêng và lựa chọn.`,

        `🌙 Đêm ${round} đã buông xuống.\n\nCả ngôi làng tắt đèn.\nNhưng trong bóng tối, vẫn có những người chưa ngủ.\n\nHãy kiểm tra tin nhắn riêng nếu đến lượt bạn.`,

        `🌙 Đêm ${round} lại đến.\n\nNgôi làng chìm vào im lặng.\nKhông ai biết bình minh sẽ mang theo điều gì.\n\nNếu vai trò của bạn có hành động, hãy mở tin nhắn riêng.\nĐêm nay, một lựa chọn của bạn có thể thay đổi mọi thứ.`,
      ] as const,
      round,
    ),

  dayBegins: (
    round: number,
    deaths: Array<{ nickname: string }>,
    silencedNickname: string | null = null,
  ) => {
    const deathNames = deaths.map((death) => death.nickname);
    const formattedDeathNames = deathNames.length <= 1
      ? deathNames[0] ?? ''
      : deathNames.length === 2
        ? `${deathNames[0]} và ${deathNames[1]}`
        : `${deathNames.slice(0, -1).join(', ')} và ${deathNames[deathNames.length - 1]}`;
    const deathCountWord = deaths.length === 1
      ? 'một'
      : deaths.length === 2
        ? 'hai'
        : String(deaths.length);
    const deathSummary = `Ngôi làng mất đi ${deathCountWord} người trước khi ánh sáng trở lại.`;

    const base =
      deaths.length === 0
        ? pickVariant(
          [
            `☀️ Bình minh ngày ${round}.\n\nMột đêm nữa đã trôi qua mà không ai biến mất.\n\nCó lẽ đêm qua thật sự yên bình...\nhoặc bóng tối chỉ đang giữ lại bí mật của mình.`,

            `☀️ Bình minh ngày ${round}.\n\nMột đêm dài đã khép lại. Tất cả vẫn còn ở đây.\n\nNhưng sự im lặng này có thật sự là bình yên?\nHay sự thật vẫn đang ẩn mình trong bóng tối.`,
          ] as const,
          round,
        )
        : `☀️ Bình minh ngày ${round}.\n\n💀 ${formattedDeathNames} đã không còn thức dậy sau đêm dài.\n\n${deathSummary}`;

    return silencedNickname
      ? `${base}\n\n🗣️ ${silencedNickname} đã bị cấm chat trong ngày hôm nay.`
      : base;
  },

  executionRoleReveal: (nickname: string, roleId: RoleId) =>
    `🎭 Màn đêm không thể che giấu tất cả.\n\n${nickname} là ${RoleNames[roleId]}.`,

  finalRoleSummary: (
    entries: Array<{ nickname: string; roleId: RoleId }>,
  ) => {
    const groupedByRole = entries.reduce<Record<RoleId, string[]>>(
      (acc, entry) => {
        if (!acc[entry.roleId]) acc[entry.roleId] = [];
        acc[entry.roleId].push(entry.nickname);
        return acc;
      },
      {} as Record<RoleId, string[]>,
    );

    const finalRoleNames = {
      ...RoleNames,
      [RoleId.WITCH]: '🧙‍♀️ Phù thủy',
    };

    return (
      `🎭 Màn đêm đã khép lại.\n\n` +
      `Những bí mật từng được chôn trong bóng tối giờ đây không còn gì để che giấu.\n\n` +
      `${Object.entries(groupedByRole)
        .map(
          ([roleId, nicknames]) =>
            `• ${finalRoleNames[roleId as RoleId]}: ${nicknames.join(', ')}`,
        )
        .join('\n')}\n\n` +
      '🌅 Không còn bí mật nào để che giấu.'
    );
  },

  // -------------------------------------------------------------------------
  // LAYER 4 — CLIMAX
  // -------------------------------------------------------------------------

  executionResult: (nickname: string | null, roleId?: RoleId) => {
    if (nickname && roleId) {
      return `⚖️ Ngôi làng đã lên tiếng.\n\n${nickname} đã nhận lấy phán quyết cuối cùng.\nCâu chuyện của họ dừng lại tại đây.\n\n🎭 Nhưng màn đêm không thể che giấu tất cả.\n\n${nickname} là ${RoleNames[roleId]}.\n\nBí mật cuối cùng đã được hé lộ.`;
    }

    return nickname
      ? pickVariant(
        [
          `⚖️ Phán quyết đã được đưa ra.\n\n${nickname} đã bị dân làng chọn. Số phận của họ đã được định đoạt.`,

          `⚖️ Ngôi làng đã lên tiếng.\n\n${nickname} đã nhận lấy phán quyết cuối cùng và không còn được tiếp tục cuộc chơi.`,
        ] as const,
      )
      : `⚖️ Không ai nhận đủ số phiếu.\n\nPhán quyết vẫn chưa được đưa ra.\n\nNgôi làng giữ lại tất cả... còn bóng tối giữ lại câu trả lời.`;
  },

  hunterShotResult: (
    hunterNickname: string,
    targetNickname: string,
  ) =>
    `🏹 Phát bắn cuối cùng vang lên.\n\n${hunterNickname} đã chọn ${targetNickname} cho phát bắn cuối cùng.`,

  gameOver: (winner: string) => {
    if (winner === WinnerTeam.VILLAGE) {
      return pickVariant(
        [
          `☀️ Bình minh đã trở lại.\n\nĐêm dài cuối cùng cũng khép lại. Những bóng tối từng ẩn mình trong ngôi làng đã biến mất.\n\n🏆 ${WinnerNames[winner]} đã chiến thắng.`,

          `☀️ Một ngày mới bắt đầu.\n\nNgôi làng đã sống sót qua những đêm dài. Không còn con Sói nào ẩn mình giữa những người còn sống.\n\n🏆 ${WinnerNames[winner]} đã giành chiến thắng.`,
        ] as const,
      );
    }

    if (winner === WinnerTeam.WEREWOLF) {
      return pickVariant(
        [
          `🌑 Ngôi làng đã im tiếng.\n\nKhông còn ai đủ sức chống lại bóng tối đang bao phủ nơi này.\n\n🏆 ${WinnerNames[winner]} đã chiến thắng.`,

          `🌑 Đêm cuối cùng đã nuốt trọn ngôi làng.\n\nNhững con Sói không còn phải ẩn mình nữa.\n\n🏆 ${WinnerNames[winner]} đã chiến thắng.`,
        ] as const,
      );
    }

    return `🌑 Câu chuyện của ngôi làng khép lại.\n\n${WinnerNames[winner] ?? winner}.`;
  },
} as const;