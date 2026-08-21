# Werewolf Telegram Bot — Content Guidelines

## Tone of voice

The bot is **bí ẩn, kịch tính, thân thiện, dễ hiểu và hơi tinh nghịch**, but clarity has priority over storytelling. Gameplay instructions are short and direct. Errors never blame the player and always state the next safe action. Announcements may carry atmosphere but must not obscure state, eligibility, deadline, or result.

## Vietnamese standard

Use natural Vietnamese and the canonical glossary. Prefer “người chơi”, “vai trò”, “ván chơi”, “giai đoạn”, “bỏ phiếu”, “còn sống”, and “đã chết”. Technical IDs may appear in logs or developer documents, not in normal player-facing messages. English is allowed only for Telegram/API concepts that have no clearer Vietnamese equivalent.

## Message hierarchy

Use this order whenever a message has multiple parts:

```text
[Emoji + short title]

[What happened]
[What the player may/should do next]
[Deadline or restriction, if relevant]
```

Action prompts should normally be one to three lines plus buttons. Errors should be one or two sentences. Announcements should normally be two to five lines. Role explanations may be longer but must be scannable with clear labels.

## Emoji policy

| Concept | Canonical emoji |
|---|---|
| Night | 🌙 |
| Day | ☀️ |
| Wolf | 🐺 |
| Seer | 🔮 |
| Bodyguard | 🛡️ |
| Witch | 🧙‍♀️ / 🧪 for potion action |
| Hunter | 🏹 |
| Silent Mage | 🤫 |
| Death | 💀 |
| Vote | 🗳️ |
| Warning | ⚠️ |
| Error | ❌ |
| Success | ✅ |

Do not add emojis decoratively to every sentence. One concept should have one stable visual identity across help, role cards, buttons, announcements, and tests.

## Button rules

Buttons are short, consistent, and imperative. Use the canonical action label, not a sentence that duplicates the prompt. Examples are `🐺 Tấn công`, `🛡️ Bảo vệ`, `🔮 Điều tra`, `🧪 Cứu`, `☠️ Đầu độc`, `🤫 Làm câm`, `🗳️ Bỏ phiếu`, and `⏭️ Bỏ qua`.

Button callback payloads must use typed/stable action identifiers. A label is not a domain key. Every callback handler must validate actor, role, phase, target, and room before applying the action.

## Error style

Use `⚠️` for recoverable user mistakes and `❌` for unavailable/system failures. Explain the reason without leaking internal stack traces, Redis URLs, Telegram tokens, hidden roles, or another player's private result. Every error should provide a safe next action where possible.

## Disclosure policy

Public content may describe lifecycle, phase transitions, deaths, public vote results, and win results. Role assignment, faction coordination, Seer results, private action prompts, potion inventory, and hidden action results are private. A public message must never imply the identity of Silent Mage, Seer, Witch, Bodyguard, Hunter, or Werewolf unless the canonical end-game rule explicitly permits role reveal.

## Capitalization and punctuation

Use sentence case in Vietnamese. Avoid full uppercase except for a short title when it improves scanability. Use one terminal punctuation style per message. Avoid repeated exclamation marks and vague technical labels such as `INVALID ACTION`.

## Content review checklist

Before merging a content change, verify grammar, canonical terminology, audience, trigger, actionability, message length, emoji consistency, information disclosure, and alignment with the domain rule and callback behavior.
