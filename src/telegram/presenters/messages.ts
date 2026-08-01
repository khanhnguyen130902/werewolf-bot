import { RoleId, Team, DeathCause, WinnerTeam } from '../../engine/domain/enums';

/** Player-facing Vietnamese text for the Telegram interface. */
export const RoleNames: Record<RoleId, string> = {
  [RoleId.WEREWOLF]: 'Sói',
  [RoleId.VILLAGER]: 'Dân làng',
  [RoleId.SEER]: 'Tiên tri',
  [RoleId.BODYGUARD]: 'B?o v?',
  [RoleId.HUNTER]: 'Th? san',
  [RoleId.WITCH]: 'Phù th?y',
};

export const RoleDescriptions: Record<RoleId, string> = {
  [RoleId.WEREWOLF]:
    'M?i dêm, b?n cùng phe Sói ch?n m?t ngu?i d? h?. Phe Sói th?ng khi s? Sói còn s?ng b?ng ho?c nhi?u hon s? Dân làng còn s?ng.',
  [RoleId.VILLAGER]:
    'B?n không có k? nang d?c bi?t. Hãy quan sát, th?o lu?n và b? phi?u d? tìm ra Sói.',
  [RoleId.SEER]:
    'M?i dêm, b?n có th? soi m?t ngu?i d? bi?t h? thu?c phe Sói hay phe Dân làng.',
  [RoleId.BODYGUARD]:
    'M?i dêm, b?n có th? b?o v? m?t ngu?i kh?i dòn t?n công c?a Sói.',
  [RoleId.HUNTER]:
    'Khi b? h?, b?n du?c ch?n m?t ngu?i d? b?n tr?. B?n cung có th? b? qua.',
  [RoleId.WITCH]:
    'B?n có m?t bình thu?c c?u và m?t bình thu?c d?c. M?i bình ch? dùng du?c m?t l?n trong c? ván; b?n có th? dùng c? hai trong cùng m?t dêm.',
};

export const TeamNames: Record<Team, string> = {
  [Team.WEREWOLF]: 'phe Sói',
  [Team.VILLAGE]: 'phe Dân làng',
};

export const DeathCauseNames: Record<string, string> = {
  [DeathCause.WEREWOLF_KILL]: 'b? Sói h? trong dêm',
  [DeathCause.VOTE_EXECUTION]: 'b? treo c? sau cu?c b? phi?u',
  [DeathCause.WITCH_POISON]: 'trúng thu?c d?c c?a Phù th?y',
  [DeathCause.HUNTER_SHOT]: 'b? Th? san b?n h?',
};

export const WinnerNames: Record<string, string> = {
  [WinnerTeam.VILLAGE]: 'phe Dân làng',
  [WinnerTeam.WEREWOLF]: 'phe Sói',
  [WinnerTeam.NONE]: 'không bên nào',
};

export const Messages = {
  groupOnly: (command: string) => `? ${command} ch? dùng du?c trong nhóm.`,
  roomClosed: () => '?? Phòng dã du?c dóng. B?n có th? t?o ván m?i trong nhóm này.',
  roomCreated: (roomId: string) => {
    const safeRoomId = String(roomId).replace(/^-/, '');
    return `?? Ðã m? phòng Ma Sói.\n\nM?i ngu?i gõ /join d? tham gia. Khi dã d? ngu?i, ch? phòng gõ /startgame d? b?t d?u.\n\nMã phòng: ${safeRoomId}`;
  },
  needDmFirst: (botUsername: string) =>
    `?? Hãy nh?n /start cho bot trong tin nh?n riêng tru?c, d? bot có th? g?i vai trò và các l?a ch?n ban dêm cho b?n.\n\n?? https://t.me/${botUsername}?start=join`,
  joined: (nickname: string, count: number) => `? ${nickname} dã vào phòng. Hi?n có ${count} ngu?i choi.`,
  alreadyJoined: () => 'B?n dã ? trong phòng này r?i.',
  left: (nickname: string) => `?? ${nickname} dã r?i phòng.`,
  roomFull: () => '? Phòng dã d? ngu?i choi.',
  roomLocked: () => '? Ván choi dã b?t d?u nên không th? tham gia thêm.',
  notEnoughPlayers: (current: number, min: number) =>
    `? C?n ít nh?t ${min} ngu?i d? b?t d?u; hi?n m?i có ${current} ngu?i.`,
  notHost: () => '? Ch? ch? phòng m?i có th? th?c hi?n vi?c này.',
  gameStarting: (playerCount: number) =>
    `?? Ván Ma Sói v?i ${playerCount} ngu?i dã b?t d?u. Vai trò dã du?c g?i riêng; dêm d?u tiên b?t d?u ngay bây gi?.`,
  roleDistributionSummary: (playerCount: number, roleCounts: Array<{ roleId: RoleId; count: number }>) => {
    const lines = roleCounts.map((entry) => `• ${RoleNames[entry.roleId]}: ${entry.count}`).join('\n');
    return `?? Phân vai cho ${playerCount} ngu?i:\n${lines}`;
  },
  roleAssigned: (roleId: RoleId) =>
    `?? B?n là **${RoleNames[roleId]}**.\n\n${RoleDescriptions[roleId]}`,
  nightBegins: (round: number) =>
    `?? Ðêm ${round} b?t d?u. Nh?ng ngu?i có k? nang ban dêm hãy ki?m tra tin nh?n riêng và dua ra l?a ch?n.`,
  actionRecorded: () => '? Ðã ghi nh?n l?a ch?n c?a b?n.',
  dayBegins: (round: number, deaths: Array<{ nickname: string; cause: string }>) => {
    if (deaths.length === 0) {
      return `?? Tr?i sáng, ngày ${round} b?t d?u. Ðêm qua không ai b? h?.`;
    }
    const lines = deaths.map((death) => `?? ${death.nickname} ${DeathCauseNames[death.cause] ?? 'dã ch?t'}.`).join('\n');
    return `?? Tr?i sáng, ngày ${round} b?t d?u.\n\n${lines}`;
  },
  discussionStarted: (seconds: number) =>
    `?? M?i ngu?i có ${seconds} giây d? th?o lu?n. Hãy chia s? thông tin và tìm ra Sói.`,
  votingStarted: (seconds: number) =>
    `??? B? phi?u b?t d?u. B?n có ${seconds} giây d? ch?n ngu?i mu?n treo c?, ho?c ch?n B? qua.`,
  voteRecorded: () => '? Phi?u c?a b?n dã du?c ghi nh?n.',
  voteAlreadyCast: () => '?? B?n dã b? phi?u trong lu?t này nên không th? thay d?i.',
  targetSelected: (action: string, targetNickname: string | null) =>
    targetNickname
      ? `? Ðã ghi nh?n l?a ch?n ${action}: **${targetNickname}**.`
      : `? B?n dã ch?n b? qua ${action}.`,
  nightActionSkipped: (action: string) => `? B?n dã ch?n b? qua ${action}.`,
  executionResult: (nickname: string | null) =>
    nickname
      ? `?? K?t qu? b? phi?u: **${nickname}** b? treo c?.`
      : '?? K?t qu? b? phi?u: không ai b? treo c? hôm nay.',
  executionRoleReveal: (nickname: string, roleId: RoleId) =>
    `?? ${nickname} là **${RoleNames[roleId]}**.`,
  hunterPrompt: (seconds: number) =>
    `?? B?n là Th? san và v?a b? h?. B?n có ${seconds} giây d? ch?n m?t ngu?i b?n tr?, ho?c b? qua.`,
  hunterShotResult: (hunterNickname: string, targetNickname: string) =>
    `?? Tru?c khi ngã xu?ng, ${hunterNickname} dã b?n h? ${targetNickname}.`,
  seerResult: (targetNickname: string, teamName: string) =>
    `?? K?t qu? soi: **${targetNickname}** thu?c **${teamName}**.`,
  gameOver: (winner: string) =>
    `?? Ván choi k?t thúc. **${WinnerNames[winner] ?? winner}** chi?n th?ng!`,
  finalRoleSummary: (entries: Array<{ nickname: string; roleId: RoleId }>) => {
    const groupedByRole = entries.reduce<Record<RoleId, string[]>>((acc, entry) => {
      if (!acc[entry.roleId]) acc[entry.roleId] = [];
      acc[entry.roleId].push(entry.nickname);
      return acc;
    }, {} as Record<RoleId, string[]>);
    const roleSections = Object.entries(groupedByRole)
      .map(([roleId, nicknames]) => `• ${RoleNames[roleId as RoleId]}: ${nicknames.join(', ')}`)
      .join('\n');
    return `?? Vai trò c?a m?i ngu?i:\n\n${roleSections}`;
  },
  werewolfTeammates: (teammates: string[]) =>
    teammates.length > 0
      ? `?? Nh?ng Sói cùng phe v?i b?n: ${teammates.join(', ')}.`
      : '?? B?n là Sói duy nh?t trong ván này.',
  hostKicked: (nickname: string) => `?? ${nickname} dã b? ch? phòng m?i ra kh?i phòng.`,
  invalidTarget: () => '? M?c tiêu không h?p l?. Hãy ch?n l?i.',
  genericError: () => '? Có l?i x?y ra. Vui lòng th? l?i.',
  actionTimeout: () => '? H?t gi?. L?a ch?n c?a b?n du?c tính là b? qua.',
} as const;