import { DomainError } from '../../engine/errors/DomainError';

/** Converts domain errors into concise, player-friendly Vietnamese. */
const ERROR_MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: 'Không tìm thấy phòng chơi này. Có thể phòng đã bị đóng.',
  ROOM_FULL: 'Phòng đã đủ người chơi.',
  ROOM_LOCKED: 'Ván chơi đã bắt đầu nên không thể tham gia thêm.',
  PLAYER_ALREADY_IN_ROOM: 'Bạn đã ở trong phòng này rồi.',
  PLAYER_NOT_IN_ROOM: 'Bạn chưa tham gia phòng này.',
  NOT_ENOUGH_PLAYERS: 'Chưa đủ người để bắt đầu ván chơi.',
  TOO_MANY_PLAYERS: 'Số người chơi đã vượt quá giới hạn của phòng.',
  NOT_HOST: 'Chỉ chủ phòng mới có thể thực hiện việc này.',
  DEAD_PLAYER_ACTION: 'Bạn đã bị loại nên không thể thực hiện hành động này.',
  INVALID_PHASE_ACTION: 'Hành động này chưa thể thực hiện ở giai đoạn hiện tại.',
  INVALID_TARGET: 'Mục tiêu không hợp lệ. Hãy chọn lại.',
  WRONG_ROLE_FOR_ACTION: 'Vai trò của bạn không thể thực hiện hành động này.',
  NO_POTION_LEFT: 'Bạn đã dùng bình thuốc này rồi.',
  CONCURRENT_MODIFICATION: 'Phòng vừa có thay đổi. Vui lòng thử lại.',
  DUPLICATE_ACTION: 'Lựa chọn này đã được ghi nhận trước đó.',
  INVALID_STATE_TRANSITION: 'Không thể thực hiện thao tác này vào lúc này.',
  DM_NOT_REACHABLE: 'Hãy nhắn /start cho bot trong tin nhắn riêng trước khi tham gia phòng.',
};

export function translateError(err: unknown): string {
  if (err instanceof DomainError) return ERROR_MESSAGES[err.code] ?? '❌ Không thể thực hiện thao tác này. Vui lòng thử lại.';
  return '❌ Có lỗi xảy ra. Vui lòng thử lại.';
}