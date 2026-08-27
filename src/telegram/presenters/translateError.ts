import { DomainError } from '../../engine/errors/DomainError';
import { CANONICAL_MESSAGES } from './canonicalContent';

/** Converts domain errors into concise, player-friendly Vietnamese. */
const ERROR_MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: CANONICAL_MESSAGES.ROOM_NOT_CREATED.text,
  ROOM_FULL: '🔒 Ngôi làng đã đủ người. Hiện không thể nhận thêm người chơi.',
  ROOM_LOCKED: '🔒 Cánh cửa làng đã đóng. Ván chơi đã bắt đầu nên không thể tham gia thêm.',
  PLAYER_ALREADY_IN_ROOM: '🌙 Bạn đã ở trong ngôi làng này rồi.',
  PLAYER_IN_ACTIVE_ROOM: CANONICAL_MESSAGES.PLAYER_IN_ACTIVE_ROOM.text,
  PLAYER_NOT_IN_ROOM: '⚠️ Bạn chưa tham gia ngôi làng này.',
  NOT_ENOUGH_PLAYERS: '⏳ Chưa đủ người để bắt đầu ván.',
  TOO_MANY_PLAYERS: '⚠️ Ngôi làng đã vượt quá giới hạn người chơi.',
  NOT_HOST: '⚠️ Chỉ host mới có quyền thực hiện việc này.',
  DEAD_PLAYER_ACTION: '💀 Bạn đã chết. Bạn không thể tiếp tục thực hiện hành động trong ván.',
  INVALID_PHASE_ACTION: '🌙 Chưa đến lúc. Bạn không thể thực hiện hành động này ở giai đoạn hiện tại.',
  INVALID_TARGET: CANONICAL_MESSAGES.INVALID_TARGET.text,
  WRONG_ROLE_FOR_ACTION: '⚠️ Vai trò của bạn không có hành động này.',
  NO_POTION_LEFT: '🧪 Lọ thuốc này đã được sử dụng.',
  CONCURRENT_MODIFICATION: '⚠️ Ngôi làng vừa có thay đổi. Vui lòng thử lại.',
  STALE_RESOLUTION: '⚠️ Ván vừa thay đổi. Kết quả này không còn được áp dụng; vui lòng thử lại.',
  DUPLICATE_ACTION: '✅ Lựa chọn này đã được ghi nhận.',
  INVALID_STATE_TRANSITION: '⚠️ Chưa thể thực hiện thao tác này lúc này.',
  DM_NOT_REACHABLE: CANONICAL_MESSAGES.DM_REQUIRED.text,
};

const GENERIC_DOMAIN_ERROR = '⚠️ Không thể thực hiện thao tác này lúc này. Vui lòng thử lại.';
const GENERIC_SYSTEM_ERROR = '❌ Có lỗi vừa xảy ra. Vui lòng thử lại.';

export function translateError(err: unknown): string {
  if (err instanceof DomainError) return ERROR_MESSAGES[err.code] ?? GENERIC_DOMAIN_ERROR;
  return GENERIC_SYSTEM_ERROR;
}
