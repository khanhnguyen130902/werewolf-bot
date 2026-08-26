import { Messages } from '../../../src/telegram/presenters/messages';

describe('Messages.dayBegins', () => {
  it('lists only the names of players who died overnight', () => {
    const message = Messages.dayBegins(1, [
      { nickname: 'Bot1' },
      { nickname: 'Bot3' },
    ]);
    expect(message).toContain('Bình minh ngày 1');
    expect(message).toContain('Bot1 và Bot3 đã không còn thức dậy sau đêm dài.');
    expect(message).toContain('Ngôi làng mất đi hai người trước khi ánh sáng trở lại.');
    expect(message).not.toContain('Bot2');
  });
});

describe('Messages.silentMageTargetSelected', () => {
  it('confirms the silence curse with the target nickname', () => {
    expect(Messages.silentMageTargetSelected('Bot1')).toBe(
      '🗣️ Lời nguyền im lặng đã được đặt xuống.\n\n🎯 Bot1 sẽ không được lên tiếng trong ngày mai.',
    );
  });
});


describe('Messages.hunterPrompt', () => {
  it('shows the night number and the Hunter instructions', () => {
    expect(Messages.hunterPrompt(1)).toBe(
      '🌙 Đêm 1.\n\nBạn là 🏹 Thợ săn.\n\nKhi thời khắc cuối cùng đến, hãy chọn mục tiêu cho phát bắn của mình, hoặc hạ vũ khí và không bắn ai.',
    );
  });
});


describe('Messages.bodyguardTargetSelected', () => {
  it('confirms the target will be protected tonight', () => {
    expect(Messages.bodyguardTargetSelected('Bot7')).toBe(
      '🛡️ Lá chắn đã được dựng lên trong bóng tối.\n\n🎯 Bot7 sẽ được bạn bảo vệ trong đêm nay.',
    );
  });
});


describe('Messages.seerResult', () => {
  it('shows the target and translated team on one line', () => {
    expect(Messages.seerResult('Bot1', 'VILLAGE')).toBe(
      '🔮 Màn đêm đã hé lộ một phần sự thật.\n\nBot1 thuộc 🧑‍🌾 Phe Dân.\n\nNhưng trong ngôi làng này, sự thật hiếm khi chỉ có một mặt.',
    );
  });
});


describe('Witch target confirmations', () => {
  it('confirms the save-potion target', () => {
    expect(Messages.witchSaveTargetSelected('Khanh Nguyen')).toBe(
      '🧪 Lời cứu đã được trao.\n\n🎯 Khanh Nguyen sẽ được bạn kéo trở lại từ ranh giới của cái chết trong đêm nay.',
    );
  });

  it('confirms the poison target', () => {
    expect(Messages.witchPoisonTargetSelected('Bot2')).toBe(
      '☠️ Một giọt độc đã được định đoạt cho đêm nay.\n\n🎯 Bot2 là người bạn chọn làm mục tiêu.',
    );
  });
});


describe('Messages.roleAssigned for Werewolf', () => {
  it('places the teammate list before the Werewolf instructions', () => {
    expect(Messages.roleAssigned('WEREWOLF' as any, ['Bot5'])).toBe(
      '🎭 Một vai trò đã được trao cho bạn.\n\nBạn là 🐺 Sói.  Lần này, bóng tối đứng về phía bạn.\n\n🐺 Bầy Sói của bạn: Bot5.\n\nTrong đêm, hãy phối hợp với những con Sói khác để chọn 1 người còn sống làm mục tiêu tấn công. Nếu không đạt được đồng thuận trước khi hết giờ, đêm đó không ai bị tấn công.\n\n🏆 Thắng khi: số Sói còn sống ≥ số người phe Dân còn sống.\n\nHãy phối hợp trong bóng tối. Đừng để lại dấu vết.',
    );
  });
});


describe('Messages.nightActionPrompt for Werewolf', () => {
  it('uses the requested target-selection wording', () => {
    expect(Messages.nightActionPrompt(1, 'WEREWOLF' as any, 'Tấn công')).toBe(
      '🌙 Đêm 1. Bóng tối đã che giấu mọi dấu vết.\n\nBầy Sói, hãy chọn người sẽ trở thành mục tiêu trong đêm nay.',
    );
  });
});


describe('Messages.roomClosed', () => {
  it('uses the requested village-closed wording', () => {
    expect(Messages.roomClosed()).toBe(
      '🛑 Câu chuyện của ván này dừng lại tại đây. Khi sẵn sàng, hãy mở một ván mới.',
    );
  });
});


describe('Messages.roomCreated', () => {
  it('uses the requested village-opening wording and preserves the room ID', () => {
    expect(Messages.roomCreated('1004377456417')).toBe(
      '🌑 Một đêm mới đang chờ đợi.\n\nCánh cửa ngôi làng đã mở.\nNhững người cuối cùng vẫn đang lần lượt bước vào, nhưng không ai biết ai sẽ đứng về phía mình.\n\nGõ /join để tham gia.\nKhi đủ người, host dùng /startgame để khép cửa và bắt đầu ván chơi.\n\n🎫 Mã phòng: 1004377456417',
    );
  });
});


describe('Messages.gameStarting', () => {
  it('uses the requested game-start wording and player count', () => {
    expect(Messages.gameStarting(6)).toBe(
      '🌑 Cánh cửa ngôi làng sắp khép lại.\n\n6 người đã sẵn sàng bước vào đêm nay.\n\n🎭 Vai trò của mỗi người đã được định đoạt và sẽ được gửi qua tin nhắn riêng.\n\nHãy kiểm tra tin nhắn riêng của bạn trước khi màn đêm buông xuống.',
    );
  });
});


describe('Messages.finalRoleSummary', () => {
  it('uses the requested closing wording and final-summary Witch icon', () => {
    expect(Messages.finalRoleSummary([
      { nickname: 'Khanh Nguyen', roleId: 'WEREWOLF' as any },
      { nickname: 'Bot4', roleId: 'WEREWOLF' as any },
      { nickname: 'Bot1', roleId: 'WITCH' as any },
      { nickname: 'Bot2', roleId: 'SEER' as any },
      { nickname: 'Bot3', roleId: 'BODYGUARD' as any },
      { nickname: 'Bot5', roleId: 'VILLAGER' as any },
    ])).toBe(
      '🎭 Màn đêm đã khép lại.\n\nNhững bí mật từng được chôn trong bóng tối giờ đây không còn gì để che giấu.\n\n• 🐺 Sói: Khanh Nguyen, Bot4\n• 🧙‍♀️ Phù thủy: Bot1\n• 🔮 Tiên tri: Bot2\n• 🛡️ Bảo vệ: Bot3\n• 🧑‍🌾 Dân làng: Bot5\n\n🌅 Không còn bí mật nào để che giấu.',
    );
  });
});


describe('Messages.executionResult with role reveal', () => {
  it('combines the verdict, story ending, and revealed role', () => {
    expect(Messages.executionResult('Khanh Nguyen', 'WEREWOLF' as any)).toBe(
      '⚖️ Ngôi làng đã lên tiếng.\n\nKhanh Nguyen đã nhận lấy phán quyết cuối cùng.\nCâu chuyện của họ dừng lại tại đây.\n\n🎭 Nhưng màn đêm không thể che giấu tất cả.\n\nKhanh Nguyen là 🐺 Sói.\n\nBí mật cuối cùng đã được hé lộ.',
    );
  });
});


describe('Messages.executionResult without majority', () => {
  it('uses the requested unresolved-verdict wording', () => {
    expect(Messages.executionResult(null)).toBe(
      '⚖️ Không ai nhận đủ số phiếu.\n\nPhán quyết vẫn chưa được đưa ra.\n\nNgôi làng giữ lại tất cả... còn bóng tối giữ lại câu trả lời.',
    );
  });
});


describe('Messages.nightBegins', () => {
  it('uses the requested wording for the round-five variant', () => {
    expect(Messages.nightBegins(5)).toBe(
      '🌙 Đêm 5 lại đến.\n\nNgôi làng chìm vào im lặng.\nKhông ai biết bình minh sẽ mang theo điều gì.\n\nNếu vai trò của bạn có hành động, hãy mở tin nhắn riêng.\nĐêm nay, một lựa chọn của bạn có thể thay đổi mọi thứ.',
    );
  });
});


describe('Messages.discussionStarted', () => {
  it('uses the requested discussion wording and timer', () => {
    expect(Messages.discussionStarted(180)).toBe(
      '💬 Giờ thảo luận bắt đầu.\n\n180 giây để lắng nghe từng lời nói, đặt câu hỏi và tìm kiếm những dấu hiệu đáng ngờ.\n\nTrong ngôi làng này, không phải lời nói nào cũng là sự thật.',
    );
  });
});


describe('Messages.dayBegins without deaths', () => {
  it('uses the first updated dawn variant for round 2', () => {
    expect(Messages.dayBegins(2, [])).toBe(
      '☀️ Bình minh ngày 2.\n\nMột đêm nữa đã trôi qua mà không ai biến mất.\n\nCó lẽ đêm qua thật sự yên bình...\nhoặc bóng tối chỉ đang giữ lại bí mật của mình.',
    );
  });

  it('uses the second updated dawn variant for round 5', () => {
    expect(Messages.dayBegins(5, [])).toBe(
      '☀️ Bình minh ngày 5.\n\nMột đêm dài đã khép lại. Tất cả vẫn còn ở đây.\n\nNhưng sự im lặng này có thật sự là bình yên?\nHay sự thật vẫn đang ẩn mình trong bóng tối.',
    );
  });
});



describe('Messages.nightBegins formatting', () => {
  it('formats the first variant with a line break before the action guidance', () => {
    expect(Messages.nightBegins(3)).toBe(
      '🌙 Đêm 3 bắt đầu.\n\nNgôi làng chìm vào im lặng.\nNếu vai trò của bạn có hành động, hãy mở tin nhắn riêng và lựa chọn.',
    );
  });

  it('formats the second variant with separated atmosphere and guidance paragraphs', () => {
    expect(Messages.nightBegins(4)).toBe(
      '🌙 Đêm 4 đã buông xuống.\n\nCả ngôi làng tắt đèn.\nNhưng trong bóng tối, vẫn có những người chưa ngủ.\n\nHãy kiểm tra tin nhắn riêng nếu đến lượt bạn.',
    );
  });
});


describe('Messages.nightActionPrompt for Silent Mage', () => {
  it('uses the requested silence-targeting wording', () => {
    expect(Messages.nightActionPrompt(1, 'SILENT_MAGE' as any, 'Làm câm')).toBe(
      '🌙 Đêm 1.\n\nBạn là 🤫 Pháp sư câm.\n\nTrong bóng tối, một người sẽ phải im lặng khi bình minh đến.\nHãy chọn mục tiêu của bạn.',
    );
  });
});


describe('Messages.joined', () => {
  it('uses the requested gathering wording and player count', () => {
    expect(Messages.joined('Trung Quach', 7)).toBe(
      '✨ Trung Quach đã bước vào ngôi làng.\n\n7 người đã tập hợp.\nChỉ còn chờ màn đêm buông xuống.',
    );
  });
});


describe('Messages.nightActionPrompt shared title', () => {
  it('uses the moon-night title for a generic special-role prompt', () => {
    expect(Messages.nightActionPrompt(1, 'WITCH' as any, 'Đầu độc')).toBe(
      '🌙 Đêm 1. Bạn là 🧙‍♂️ Phù thủy. Đã đến lúc thực hiện đầu độc của mình.',
    );
  });
});


describe('Messages.roleAssigned for Hunter', () => {
  it('uses the revised Hunter role description', () => {
    expect(Messages.roleAssigned('HUNTER' as any)).toBe(
      '🎭 Một vai trò đã được trao cho bạn.\n\nBạn là 🏹 Thợ săn.\n\n🏹 Bạn luôn giữ lại một viên đạn cho thời khắc cuối cùng.\n\n🎯 Khi bạn chết vì bất kỳ nguyên nhân nào bạn được chọn 1 người còn sống để bắn trả.\n⚠️ Bạn có thể lựa chọn không sử dụng phát bắn cuối cùng.\n🏆 Thắng khi: tất cả Sói đã bị loại khỏi ván.',
    );
  });
});


describe('Messages.nightActionPrompt for Bodyguard', () => {
  it('uses the requested protection-targeting wording', () => {
    expect(Messages.nightActionPrompt(1, 'BODYGUARD' as any, 'Bảo vệ')).toBe(
      '🌙 Đêm 1.\n\nBạn là 🛡️ Bảo vệ.\n\n🛡️ Khi cả ngôi làng chìm vào giấc ngủ, bạn vẫn còn thức.\n\nĐêm nay, hãy chọn người bạn muốn bảo vệ.',
    );
  });
});


describe('Messages.nightActionPrompt for Seer', () => {
  it('uses the requested investigation wording', () => {
    expect(Messages.nightActionPrompt(1, 'SEER' as any, 'Điều tra')).toBe(
      '🌙 Đêm 1.\n\nBạn là 🔮 Tiên tri.\n\nMàn đêm che giấu nhiều điều.\nNhưng không phải bí mật nào cũng có thể giữ kín mãi.\n\nĐêm nay, hãy chọn một người để khám phá phe của họ.',
    );
  });
});

