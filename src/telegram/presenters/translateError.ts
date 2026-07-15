import { DomainError } from '../../engine/errors/DomainError';

/**
 * Maps DomainError codes to Vietnamese messages. This is the ONLY place
 * that translates engine error codes into display text, keeping the engine
 * itself free of any language-specific strings (see messages.ts doc for the
 * same rationale applied to success-path messages).
 */
const ERROR_MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: 'Không tìm thấy phòng chơi này. Có thể phòng đã bị đóng.',
  ROOM_FULL: 'Phòng đã đủ người chơi tối đa.',
  ROOM_LOCKED: 'Ván đang diễn ra, không thể tham gia lúc này.',
  PLAYER_ALREADY_IN_ROOM: 'Bạn đã tham gia phòng này rồi.',
  PLAYER_NOT_IN_ROOM: 'Bạn chưa tham gia phòng này.',
  NOT_ENOUGH_PLAYERS: 'Chưa đủ người chơi để bắt đầu ván.',
  TOO_MANY_PLAYERS: 'Số người chơi vượt quá giới hạn cho phép.',
  NOT_HOST: 'Chỉ Host (người tạo phòng) mới có thể thực hiện thao tác này.',
  DEAD_PLAYER_ACTION: 'Bạn đã bị loại, không thể thực hiện hành động này.',
  INVALID_PHASE_ACTION: 'Hành động này không hợp lệ ở giai đoạn hiện tại.',
  INVALID_TARGET: 'Mục tiêu không hợp lệ. Vui lòng chọn lại.',
  WRONG_ROLE_FOR_ACTION: 'Vai trò của bạn không thể thực hiện hành động này.',
  NO_POTION_LEFT: 'Bạn đã dùng hết bình thuốc này rồi.',
  CONCURRENT_MODIFICATION: 'Có xung đột dữ liệu, vui lòng thử lại.',
  DUPLICATE_ACTION: 'Hành động này đã được ghi nhận trước đó rồi.',
  INVALID_STATE_TRANSITION: 'Không thể thực hiện thao tác này lúc này.',
  DM_NOT_REACHABLE: 'Bạn cần nhắn /start cho bot ở tin nhắn riêng trước khi tham gia phòng.',
};

/** Converts any error into a user-facing Vietnamese message. Falls back to a
 * generic message for non-DomainError exceptions (e.g. unexpected bugs),
 * since exposing raw internal error text to end users is poor UX and can
 * leak implementation details. */
export function translateError(err: unknown): string {
  if (err instanceof DomainError) {
    return ERROR_MESSAGES[err.code] ?? `❌ Đã xảy ra lỗi: ${err.message}`;
  }
  return `❌ Đã xảy ra lỗi không xác định. Vui lòng thử lại.`;
}
