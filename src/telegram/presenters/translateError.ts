import { DomainError } from '../../engine/errors/DomainError';

/** Converts domain errors into concise, player-friendly Vietnamese. */
const ERROR_MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: 'Không tìm th?y phòng choi này. Có th? phòng dã b? dóng.',
  ROOM_FULL: 'Phòng dã d? ngu?i choi.',
  ROOM_LOCKED: 'Ván choi dã b?t d?u nên không th? tham gia thêm.',
  PLAYER_ALREADY_IN_ROOM: 'B?n dã ? trong phòng này r?i.',
  PLAYER_NOT_IN_ROOM: 'B?n chua tham gia phòng này.',
  NOT_ENOUGH_PLAYERS: 'Chua d? ngu?i d? b?t d?u ván choi.',
  TOO_MANY_PLAYERS: 'S? ngu?i choi dã vu?t quá gi?i h?n c?a phòng.',
  NOT_HOST: 'Ch? ch? phòng m?i có th? th?c hi?n vi?c này.',
  DEAD_PLAYER_ACTION: 'B?n dã b? lo?i nên không th? th?c hi?n hành d?ng này.',
  INVALID_PHASE_ACTION: 'Hành d?ng này chua th? th?c hi?n ? giai do?n hi?n t?i.',
  INVALID_TARGET: 'M?c tiêu không h?p l?. Hãy ch?n l?i.',
  WRONG_ROLE_FOR_ACTION: 'Vai trò c?a b?n không th? th?c hi?n hành d?ng này.',
  NO_POTION_LEFT: 'B?n dã dùng bình thu?c này r?i.',
  CONCURRENT_MODIFICATION: 'Phòng v?a có thay d?i. Vui lòng th? l?i.',
  DUPLICATE_ACTION: 'L?a ch?n này dã du?c ghi nh?n tru?c dó.',
  INVALID_STATE_TRANSITION: 'Không th? th?c hi?n thao tác này vào lúc này.',
  DM_NOT_REACHABLE: 'Hãy nh?n /start cho bot trong tin nh?n riêng tru?c khi tham gia phòng.',
};

export function translateError(err: unknown): string {
  if (err instanceof DomainError) {
    return ERROR_MESSAGES[err.code] ?? '? Không th? th?c hi?n thao tác này. Vui lòng th? l?i.';
  }
  return '? Có l?i x?y ra. Vui lòng th? l?i.';
}