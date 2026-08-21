import { RoleId, NightActionType } from '../../engine/domain/enums';

export type ContentAudience =
  | 'PUBLIC'
  | 'ROLE_PRIVATE'
  | 'PLAYER_PRIVATE'
  | 'DEAD_PLAYER'
  | 'SYSTEM_ONLY'
  | 'ADMIN_ONLY';

export type ContentPriority = 'INFO' | 'HIGH' | 'CRITICAL';

export interface CanonicalMessage {
  readonly id: string;
  readonly event: string;
  readonly audience: ContentAudience;
  readonly priority: ContentPriority;
  readonly text: string;
}

export const ROLE_DISPLAY_NAMES: Record<RoleId, string> = {
  [RoleId.VILLAGER]: 'Dân làng',
  [RoleId.WEREWOLF]: 'Sói',
  [RoleId.HUNTER]: 'Thợ săn',
  [RoleId.SEER]: 'Tiên tri',
  [RoleId.BODYGUARD]: 'Bảo vệ',
  [RoleId.WITCH]: 'Phù thủy',
  [RoleId.SILENT_MAGE]: 'Pháp sư câm',
};

export const ROLE_EMOJIS: Record<RoleId, string> = {
  [RoleId.VILLAGER]: '🧑‍🌾',
  [RoleId.WEREWOLF]: '🐺',
  [RoleId.HUNTER]: '🏹',
  [RoleId.SEER]: '🔮',
  [RoleId.BODYGUARD]: '🛡️',
  [RoleId.WITCH]: '🧙‍♀️',
  [RoleId.SILENT_MAGE]: '🤫',
};

export const ACTION_DISPLAY_NAMES: Partial<Record<NightActionType, string>> = {
  [NightActionType.WEREWOLF_VOTE_KILL]: 'Tấn công',
  [NightActionType.BODYGUARD_PROTECT]: 'Bảo vệ',
  [NightActionType.SEER_INSPECT]: 'Điều tra',
  [NightActionType.WITCH_SAVE]: 'Cứu',
  [NightActionType.WITCH_POISON]: 'Đầu độc',
  [NightActionType.SILENT_MAGE_SILENCE]: 'Làm câm',
  [NightActionType.HUNTER_SHOOT]: 'Bắn trả',
};

export const ACTION_BUTTON_LABELS: Partial<Record<NightActionType, string>> = {
  [NightActionType.WEREWOLF_VOTE_KILL]: '🐺 Tấn công',
  [NightActionType.BODYGUARD_PROTECT]: '🛡️ Bảo vệ',
  [NightActionType.SEER_INSPECT]: '🔮 Điều tra',
  [NightActionType.WITCH_SAVE]: '🧪 Cứu',
  [NightActionType.WITCH_POISON]: '☠️ Đầu độc',
  [NightActionType.SILENT_MAGE_SILENCE]: '🤫 Làm câm',
  [NightActionType.HUNTER_SHOOT]: '🏹 Bắn trả',
};

export const CANONICAL_HELP_TEXT = [
  '🐺 WEREWOLF BOT',
  'Trợ lý điều hành game Ma Sói trên Telegram',
  '━━━━━━━━━━━━━━━━━━',
  '',
  '🚀 BẮT ĐẦU NHANH',
  '1. Nhắn /start cho bot trong tin nhắn riêng.',
  '2. Trong group, host dùng /create để mở phòng.',
  '3. Người chơi dùng /join để tham gia.',
  '4. Host dùng /startgame khi đã đủ người.',
  '5. Làm theo nút hành động bot gửi trong DM.',
  '',
  '🎮 LỆNH NGƯỜI CHƠI',
  '/start — Kích hoạt DM để nhận role và thông báo riêng.',
  '/join — Tham gia phòng đang mở trong group.',
  '/leave — Rời phòng trước khi ván bắt đầu.',
  '/status — Xem trạng thái phòng và số người chơi.',
  '/vote — Gửi phiếu thủ công khi cần.',
  '',
  '👑 LỆNH HOST',
  '/create — Tạo phòng mới trong group.',
  '/startgame — Khóa phòng và bắt đầu ván.',
  '/end — Kết thúc phòng hiện tại.',
  '',
  '🧪 KIỂM THỬ',
  '/bottest — Tạo phòng test với bot tự động.',
  'Chỉ dùng trong group development, không dùng ở production.',
  '',
  '🌙 CÁCH CHƠI',
  '• Ban đêm: role đặc biệt chọn hành động qua nút trong DM.',
  '• Ban ngày: mọi người thảo luận và bỏ phiếu trong group.',
  '• Người chết: không tiếp tục hành động hoặc tiết lộ role.',
  '• Ván kết thúc khi một phe đạt điều kiện chiến thắng.',
  '',
  '🔒 QUY TẮC QUAN TRỌNG',
  '• Luôn nhắn /start cho bot trước khi tham gia phòng.',
  '• Chỉ host mới được bắt đầu hoặc kết thúc ván.',
  '• Không chia sẻ role và nội dung DM vào group.',
  '• Nếu chưa tạo game, /join sẽ báo phòng chưa tồn tại.',
  '',
  '💡 CẦN TRỢ GIÚP?',
  'Dùng /help bất cứ lúc nào để mở lại hướng dẫn này.',
].join('\n');

export const CANONICAL_MESSAGES = {
  HELP_OVERVIEW: {
    id: 'HELP.OVERVIEW',
    event: 'HELP_REQUESTED',
    audience: 'PUBLIC',
    priority: 'INFO',
    text: CANONICAL_HELP_TEXT,
  },
  ROOM_NOT_FOUND: {
    id: 'ERROR.ROOM_NOT_FOUND',
    event: 'JOIN_REQUESTED',
    audience: 'PUBLIC',
    priority: 'HIGH',
    text: '⚠️ Không tìm thấy phòng chơi này. Có thể phòng đã bị đóng.',
  },
  DM_REQUIRED: {
    id: 'ERROR.DM_REQUIRED',
    event: 'JOIN_REQUESTED',
    audience: 'PLAYER_PRIVATE',
    priority: 'HIGH',
    text: '⚠️ Trước khi bước vào cuộc chơi, hãy nhắn /start cho bot trong tin nhắn riêng để nhận vai trò và thông báo.',
  },
  INVALID_TARGET: {
    id: 'ERROR.INVALID_TARGET',
    event: 'ACTION_REJECTED',
    audience: 'PLAYER_PRIVATE',
    priority: 'HIGH',
    text: '⚠️ Mục tiêu này không hợp lệ. Hãy chọn một người còn sống trong ván.',
  },
  ACTION_COMPLETED: {
    id: 'ACTION.COMPLETED',
    event: 'ACTION_SUBMITTED',
    audience: 'PLAYER_PRIVATE',
    priority: 'INFO',
    text: '✅ Hành động của bạn đã được ghi nhận.',
  },
  GAME_STARTED: {
    id: 'GAME.STARTED',
    event: 'GAME_STARTED',
    audience: 'PUBLIC',
    priority: 'HIGH',
    text: '🌙 Ván chơi bắt đầu. Hãy kiểm tra tin nhắn riêng để xem vai trò và hành động của bạn.',
  },
  PLAYER_DIED: {
    id: 'PLAYER.DEAD',
    event: 'PLAYER_DIED',
    audience: 'PUBLIC',
    priority: 'HIGH',
    text: '💀 Một người chơi đã chết trong ván.',
  },
  VILLAGE_WIN: {
    id: 'GAME.WIN.VILLAGE',
    event: 'WIN_CONDITION_MET',
    audience: 'PUBLIC',
    priority: 'HIGH',
    text: '✅ Phe Dân đã chiến thắng!',
  },
  WOLF_WIN: {
    id: 'GAME.WIN.WOLF',
    event: 'WIN_CONDITION_MET',
    audience: 'PUBLIC',
    priority: 'HIGH',
    text: '🐺 Phe Sói đã chiến thắng!',
  },
} as const satisfies Record<string, CanonicalMessage>;

export type CanonicalMessageKey = keyof typeof CANONICAL_MESSAGES;

export function getCanonicalMessage(key: CanonicalMessageKey): string {
  return CANONICAL_MESSAGES[key].text;
}
