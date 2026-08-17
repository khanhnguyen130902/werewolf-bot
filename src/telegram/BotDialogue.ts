import { BotPersonality } from './BotPolicy';

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] ?? items[0];
}

const MORNING_LINES = [
  'Chào buổi sáng! Đêm qua ai ngủ ngon không, hay có người vừa đi làm ca đêm cho phe Sói?',
  'Điểm danh nào: ai còn sống giơ tay, ai không giơ tay thì… thôi, làng tự hiểu.',
  'Đêm qua yên bình quá. Bình yên kiểu này thường là trailer cho một cú plot twist.',
  'Tôi đã suy nghĩ cả đêm và kết luận: mình vẫn chưa hiểu chuyện gì đang xảy ra.',
  'Có ai có thông tin không? Đừng ngại, nói sai cũng được, miễn là nói thật… hoặc nói thuyết phục.',
  'Hôm nay là một ngày đẹp trời để tìm Sói và một ngày rất tệ để bị vote oan.',
  'Tôi xin phép mở cuộc họp khẩn: ai nhìn đáng ngờ hơn cả lịch sử tìm kiếm của tôi?',
  'Làng ta thiếu bằng chứng, nhưng thừa tự tin. Tuyệt vời, đúng chất Ma Sói.',
  'Mọi người bình tĩnh. Nếu hoảng loạn thì nhớ hoảng loạn có chiến lược.',
  'Tôi không nói ai là Sói đâu, nhưng ai đang đọc câu này thì tự kiểm điểm nhé.',
  'Báo cáo nhanh: tim còn đập, não đang tải, còn lòng tin thì đã mất kết nối.',
  'Ai pha cà phê chưa? Muốn đấu trí với Sói mà thiếu caffeine là hơi mạo hiểm.',
] as const;

const QUIET_LINES = [
  'Tôi xin phép quan sát trong im lặng. Im lặng không có nghĩa là đáng ngờ, chỉ là mạng xã hội đã làm tôi mệt.',
  'Chưa đủ dữ kiện. Tôi tạm thời tin mọi người… ở mức 3%.',
  'Tôi đang ghi chú. Đừng ai làm gì đáng ngờ trong lúc tôi chớp mắt.',
  'Tôi chưa có bằng chứng, nhưng trực giác đang rung như điện thoại trong túi.',
] as const;

const ACCUSATION_LINES = [
  'Tôi không muốn kết luận vội, nhưng target này đang có mùi Sói… hoặc mùi deadline, khá khó phân biệt.',
  'Lập luận của tôi có thể chưa hoàn hảo, nhưng ít nhất nó đã xuất hiện đúng giờ.',
  'Tôi đề nghị cả làng nhìn kỹ người này. Nhìn kỹ thôi nhé, đừng nhìn đến mức họ ngại.',
  'Có gì đó không ổn. Và lần này không phải do tôi quên đọc luật.',
  'Tôi nghi người này. Nếu sai thì coi như chúng ta vừa có thêm một bài học rất đắt.',
] as const;

const DEFENSE_LINES = [
  'Khoan vote! Người ta im lặng chưa chắc là Sói, có thể chỉ đang nghĩ câu trả lời cho đỡ quê.',
  'Claim này nghe rất tự tin. Mà người tự tin nhất phòng thường là người có hoặc không có gì để giấu.',
  'Mọi người đừng biến cuộc thảo luận thành cuộc thi ai nói to hơn.',
  'Tôi xin phản biện: nghi ngờ là quyền của mọi người, nhưng vote oan là trách nhiệm của cả làng.',
  'Chưa đủ bằng chứng. Kết tội lúc này khác gì ném xúc xắc rồi gọi đó là chiến thuật?',
] as const;

const DECEPTIVE_LINES = [
  'Tôi là dân thường chính hiệu. Bằng chứng là tôi cũng đang hoang mang như mọi người.',
  'Nếu tôi là Sói thì tôi đã không nói câu này. Nếu tôi không phải Sói thì… câu này vẫn đúng.',
  'Mọi người đang tập trung sai hướng rồi. Tôi biết hướng đúng, nhưng nói ra thì hơi nguy hiểm cho… làng.',
  'Tôi đề nghị vote người khác trước để có thêm dữ liệu. Dữ liệu gì thì tính sau.',
  'Tôi hoàn toàn ủng hộ sự thật, miễn là sự thật không quay sang cắn tôi.',
] as const;

const AGGRESSIVE_LINES = [
  'Đủ họp báo rồi, cho tôi một cái tên để vote. Tôi đến đây không phải để ngắm giao diện.',
  'Tôi không bảo đảm mình đúng, nhưng tôi bảo đảm mình nói rất tự tin.',
  'Nếu hôm nay không vote được Sói thì ngày mai chúng ta mở cuộc họp về việc tại sao hôm nay không vote được Sói.',
  'Tôi đã khoanh vùng rồi. Vùng hơi rộng, nhưng ít nhất đã có bản đồ.',
] as const;

const CLAIM_REACTIONS = [
  'Nghe hợp lý. Nhưng tôi sẽ tin sau khi kiểm tra xem người này có đang diễn hơi nhập tâm không.',
  'Claim mạnh đấy. Tôi cho 7/10 điểm tự tin, còn độ thật thì hệ thống đang tải.',
  'Nếu là Tiên Tri thật thì tuyệt. Nếu là Tiên Tri giả thì cũng tuyệt… cho phe Sói.',
  'Tôi ghi nhận claim. Ghi nhận không đồng nghĩa với tin, giống như seen không đồng nghĩa với trả lời.',
  'Bình tĩnh, đừng biến một câu claim thành giấy phép treo cổ ngay lập tức.',
] as const;

const WOLF_CLAIM_LINES = [
  'Tôi là Tiên Tri! Đêm qua tôi soi **{target}** và phát hiện đây là Sói. Lần này trực giác có hóa đơn đầy đủ.',
  'Xin phép claim Tiên Tri: **{target}** có gì đó rất… không thuộc về phe Dân. Mùi này không phải mùi bánh mì.',
  'Tôi đã soi **{target}**. Kết quả khiến tôi muốn kiểm tra lại máy soi, nhưng Sói vẫn là Sói.',
] as const;

const VILLAGE_CLAIM_LINES = [
  'Tôi là Tiên Tri! **{target}** thuộc phe Dân. Ít nhất người này hôm nay được miễn một gói nghi ngờ.',
  'Đêm qua tôi soi **{target}**, kết quả là người tốt. Xin đừng vote họ chỉ vì họ dùng quá nhiều dấu chấm than.',
  '**{target}** đã được kiểm tra và tạm thời sạch. Tạm thời thôi, Ma Sói không có bảo hành trọn đời.',
] as const;

const EXECUTION_LINES = [
  'Một người đã rời cuộc chơi. Xin chia buồn, và xin mọi người đừng để đây là quyết định tệ nhất hôm nay.',
  'Làng vừa đưa ra phán quyết. Nếu đúng thì thiên tài, nếu sai thì… chúng ta gọi đó là dữ liệu.',
  'Cái giá của dân chủ là đôi khi cả làng cùng tự tin sai.',
  'Một lá phiếu đã hóa thành định mệnh. Tôi đề nghị lần sau đọc kỹ trước khi bấm.',
] as const;

export const BotDialogue = {
  generic(random = Math.random): string {
    return pick(MORNING_LINES, random);
  },

  quiet(random = Math.random): string {
    return pick(QUIET_LINES, random);
  },

  seerClaim(targetNickname: string, revealedTeam: string, random = Math.random): string {
    const lines = revealedTeam === 'WEREWOLF' ? WOLF_CLAIM_LINES : VILLAGE_CLAIM_LINES;
    return pick(lines, random).replaceAll('{target}', targetNickname);
  },

  reaction(
    nickname: string,
    personality: BotPersonality,
    targetNickname: string,
    revealedTeam: string,
    random = Math.random,
  ): string {
    let line: string;
    if (personality === 'quiet') {
      line = pick(QUIET_LINES, random);
    } else if (personality === 'deceptive') {
      line = pick(DECEPTIVE_LINES, random);
    } else if (personality === 'aggressive' && revealedTeam === 'WEREWOLF') {
      line = pick(AGGRESSIVE_LINES, random);
    } else if (revealedTeam === 'WEREWOLF' && random() < 0.55) {
      line = pick(ACCUSATION_LINES, random);
    } else {
      line = pick(DEFENSE_LINES, random);
    }
    return `💬 ${nickname}: "${line.replaceAll('{target}', targetNickname)}"`;
  },

  claimReaction(nickname: string, random = Math.random): string {
    return `💬 ${nickname}: "${pick(CLAIM_REACTIONS, random)}"`;
  },

  execution(random = Math.random): string {
    return `💬 ${pick(EXECUTION_LINES, random)}`;
  },
};
