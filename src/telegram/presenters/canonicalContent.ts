import { RoleId, NightActionType } from '../../engine/domain/enums';

export type ContentAudience =
  | 'PUBLIC'
  | 'ROLE_PRIVATE'
  | 'PLAYER_PRIVATE'
  | 'DEAD_PLAYER'
  | 'SYSTEM_ONLY'
  | 'ADMIN_ONLY';

export type ContentPriority = 'INFO' | 'HIGH' | 'CRITICAL';
export type ContentLayer = 'PURE_SYSTEM' | 'GAMEPLAY' | 'NARRATIVE' | 'CLIMAX';

export interface CanonicalMessage {
  readonly id: string;
  readonly event: string;
  readonly audience: ContentAudience;
  readonly priority: ContentPriority;
  readonly layer: ContentLayer;
  readonly text: string;
  readonly variants?: readonly string[];
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
  'Chào mừng bạn đến với Werewolf Bot!',
  'Tham gia trò chơi Ma Sói, phối hợp cùng đồng đội, khám phá danh tính các người chơi và tìm cách đưa phe của mình đến chiến thắng.',
  '━━━━━━━━━━━━━━━━━━',
  '',
  '🚀 HƯỚNG DẪN BẮT ĐẦU',
  '1. Nhắn /start cho bot qua tin nhắn riêng (DM) để kích hoạt.',
  '2. Trong group, host sử dụng /create để tạo phòng chơi.',
  '3. Người chơi sử dụng /join để tham gia phòng.',
  '4. Khi đủ người chơi, host sử dụng /startgame để bắt đầu ván.',
  '5. Thực hiện các hành động theo hướng dẫn và nút tương tác mà bot gửi qua DM.',
  '',
  '🎮 LỆNH NGƯỜI CHƠI',
  '/start - Kích hoạt DM để nhận vai trò và thông báo từ bot.',
  '/join - Tham gia phòng chơi đang mở trong group.',
  '/leave - Rời phòng trước khi ván chơi bắt đầu.',
  '/status - Kiểm tra trạng thái phòng và số lượng người chơi.',
  '/vote - Gửi phiếu bầu thủ công khi cần thiết.',
  '',
  '👑 LỆNH HOST',
  '/create - Tạo phòng chơi mới trong group.',
  '/startgame - Khóa phòng và bắt đầu ván chơi.',
  '/end - Kết thúc ván chơi và đóng phòng hiện tại.',
  '',
  '🧪 CHẾ ĐỘ KIỂM THỬ',
  '/bottest - Tạo phòng kiểm thử với người chơi tự động.',
  'Lưu ý: Chỉ sử dụng lệnh này trong group development. Không sử dụng trên môi trường production.',
  '',
  '🌙 LUẬT CHƠI CƠ BẢN',
  '• Ban đêm: Người chơi có vai trò đặc biệt thực hiện hành động thông qua các nút tương tác trong DM.',
  '• Ban ngày: Những người chơi còn sống thảo luận và bỏ phiếu tại group.',
  '• Người chơi đã bị loại không được tiếp tục thực hiện hành động trong ván.',
  '• Trò chơi kết thúc khi một phe đáp ứng điều kiện chiến thắng.',
  '',
  '🔒 LƯU Ý QUAN TRỌNG',
  '• Người chơi cần nhắn /start cho bot trước khi tham gia phòng để đảm bảo nhận được thông báo riêng.',
  '• Chỉ host mới có quyền bắt đầu hoặc kết thúc ván chơi.',
  '• Không chia sẻ vai trò hoặc nội dung tin nhắn riêng từ bot lên group.',
  '• Nếu chưa có phòng chơi, lệnh /join sẽ không thể thực hiện.',
  '',
  '💡 TRỢ GIÚP',
  'Sử dụng /help bất cứ lúc nào để xem hướng dẫn và danh sách lệnh.',
  'Chúc bạn có những giây phút chơi Ma Sói thật thú vị!',
].join('\n');

export const CANONICAL_MESSAGES = {
  HELP_OVERVIEW: {
    id: 'HELP.OVERVIEW',
    event: 'HELP_REQUESTED',
    audience: 'PUBLIC',
    priority: 'INFO',
    layer: 'GAMEPLAY',
    text: CANONICAL_HELP_TEXT,
  },
  ROOM_NOT_FOUND: {
    id: 'ERROR.ROOM_NOT_FOUND',
    event: 'JOIN_REQUESTED',
    audience: 'PUBLIC',
    priority: 'HIGH',
    layer: 'PURE_SYSTEM',
    text: '⚠️ Chưa có phòng chơi đang mở trong group này.',
  },
  ROOM_NOT_CREATED: {
    id: 'ERROR.ROOM_NOT_CREATED',
    event: 'JOIN_REQUESTED',
    audience: 'PUBLIC',
    priority: 'HIGH',
    layer: 'PURE_SYSTEM',
    text: '⚠️ Chưa có phòng chơi nào ở đây. Host hãy dùng /create để mở phòng trước.',
  },
  DM_REQUIRED: {
    id: 'ERROR.DM_REQUIRED',
    event: 'JOIN_REQUESTED',
    audience: 'PLAYER_PRIVATE',
    priority: 'HIGH',
    layer: 'PURE_SYSTEM',
    text: '⚠️ Một bước trước khi vào phòng chơi. Hãy nhắn /start cho bot trong tin nhắn riêng để nhận vai trò và thông báo.',
  },
  PLAYER_IN_ACTIVE_ROOM: {
    id: 'ERROR.PLAYER_IN_ACTIVE_ROOM',
    event: 'ROOM_JOIN_OR_CREATE_REQUESTED',
    audience: 'PUBLIC',
    priority: 'HIGH',
    layer: 'PURE_SYSTEM',
    text: '🌙 Bạn vẫn đang ở trong một ván chơi đang diễn ra.\nHãy kết thúc hoặc rời ván hiện tại trước khi tham gia ván mới.',
  },
  PLAYER_NOT_IN_GAME: {
    id: 'ERROR.PLAYER_NOT_IN_GAME',
    event: 'PLAYER_ACTION_REQUESTED',
    audience: 'PLAYER_PRIVATE',
    priority: 'HIGH',
    layer: 'PURE_SYSTEM',
    text: '⚠️ Bạn chưa tham gia ván hiện tại nên chưa thể bỏ phiếu.',
  },
  INVALID_TARGET: {
    id: 'ERROR.INVALID_TARGET',
    event: 'ACTION_REJECTED',
    audience: 'PLAYER_PRIVATE',
    priority: 'HIGH',
    layer: 'PURE_SYSTEM',
    text: '⚠️ Mục tiêu chưa hợp lệ. Hãy chọn một người còn sống trong ván.',
  },
  ACTION_COMPLETED: {
    id: 'ACTION.COMPLETED',
    event: 'ACTION_SUBMITTED',
    audience: 'PLAYER_PRIVATE',
    priority: 'INFO',
    layer: 'GAMEPLAY',
    text: '✅ Đã ghi nhận. Lựa chọn của bạn sẽ được xử lý theo luật của ván.',
  },
  GAME_STARTED: {
    id: 'GAME.STARTED',
    event: 'GAME_STARTED',
    audience: 'PUBLIC',
    priority: 'HIGH',
    layer: 'NARRATIVE',
    text: '🌙 Màn đêm buông xuống. Hãy kiểm tra tin nhắn riêng để xem vai trò và hành động của bạn.',
    variants: [
      '🌙 Ngôi làng chìm vào bóng tối. Vai trò và hành động của bạn đang chờ trong tin nhắn riêng.',
      '🌙 Đêm lại đến. Hãy mở tin nhắn riêng; đừng để lựa chọn đầu tiên của bạn bị bỏ lỡ.',
    ],
  },
  PLAYER_DIED: {
    id: 'PLAYER.DEAD',
    event: 'PLAYER_DIED',
    audience: 'PUBLIC',
    priority: 'HIGH',
    layer: 'CLIMAX',
    text: '💀 Một người đã không còn thức dậy. Người chơi đã chết và không thể tiếp tục hành động trong ván.',
  },
  VILLAGE_WIN: {
    id: 'GAME.WIN.VILLAGE',
    event: 'WIN_CONDITION_MET',
    audience: 'PUBLIC',
    priority: 'HIGH',
    layer: 'CLIMAX',
    text: '☀️ Bình minh cuối cùng cũng đến. Những bóng tối còn sót lại đã biến mất. Phe Dân chiến thắng.',
  },
  WOLF_WIN: {
    id: 'GAME.WIN.WOLF',
    event: 'WIN_CONDITION_MET',
    audience: 'PUBLIC',
    priority: 'HIGH',
    layer: 'CLIMAX',
    text: '🌑 Ngôi làng đã tắt tiếng. Không còn ai đủ sức chống lại bóng tối. Phe Sói chiến thắng.',
  },
} as const satisfies Record<string, CanonicalMessage>;

export type CanonicalMessageKey = keyof typeof CANONICAL_MESSAGES;

export function getCanonicalMessage(key: CanonicalMessageKey): string {
  return CANONICAL_MESSAGES[key].text;
}
