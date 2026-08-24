# Werewolf Telegram Bot — Dark Horror & Friendly Content Style Guide

**Status:** Canonical content-direction guide. This document extends the existing game-rule and terminology canon; it does not add roles, mechanics, win conditions, or information disclosure.

## 1. Brand concept

The bot presents **a mysterious village after dark**. During the day, players gather, discuss, and question one another. At night, the village becomes quiet, uncertain, and watchful. The atmosphere is original writing inspired by classic Werewolf themes: village life, suspicion, deception, survival, and mystery.

The emotional balance is approximately 40% mystery, 25% horror, 20% suspense, 10% friendliness, and 5% light humor. These proportions guide consistency; they are not a runtime mechanic.

## 2. Tone of voice

The narrator is a calm, observant, slightly cold but friendly Game Master who seems to know the village's secrets without threatening or humiliating players. The writing should feel atmospheric but never obscure what the player must understand or do.

The priority order is **clarity → rule accuracy → actionability → consistency → atmosphere → humor**. Storytelling must never change the meaning of a rule, hide an available action, or imply an outcome that the resolver has not confirmed.

## 3. Message layers

| Layer | Purpose | Writing rule |
|---|---|---|
| Pure system | Errors, permissions, state restrictions | Short, direct, actionable; little or no narrative |
| Gameplay | Prompts, confirmations, phase instructions | Clear CTA with one restrained atmospheric cue |
| Narrative | Night, dawn, lobby, major transitions | Short scene-setting followed by gameplay facts |
| Climax | Death, victory, defeat, final game end | Cinematic but concise; never graphic or melodramatic |

## 4. Narrator vocabulary

Preferred imagery includes bóng tối, ánh trăng, tiếng gió, cánh cửa, dấu vết, ánh mắt, im lặng, bí mật, đêm dài, bình minh, and ngôi làng. Use these words selectively. Avoid repeating the same opening structure in every message.

Gameplay terms remain stable even when narrative wording varies. The canonical terms are **đã chết**, **mục tiêu**, **hành động**, **bỏ phiếu**, **Đêm**, **Ngày**, **Kết thúc ván**, **Phe Dân**, and **Phe Sói**.

## 5. Forbidden or discouraged vocabulary

Do not use threats, insults, graphic violence, slang-heavy language, or wording that makes a player feel personally attacked. Avoid expressions such as “ngươi sẽ phải chết”, “mày đã bị loại”, graphic descriptions of bodies, and corporate support language. Avoid overused openings such as “Hỡi những người dân”, “Ôi không”, or “Bóng tối đang bao trùm” in every event.

Do not use role labels that conflict with `GAME_GLOSSARY.md`. In particular, do not use `🧞 Pháp sư câm` as the canonical Silent Mage label; the canonical visual anchor is `🤫 Pháp sư câm`.

## 6. Emoji system

Emoji are visual anchors, not decoration. Use one primary anchor when possible and avoid stacking multiple unrelated symbols.

| Concept | Canonical emoji |
|---|---|
| Night | 🌙 |
| Day | ☀️ |
| Werewolf | 🐺 |
| Seer | 🔮 |
| Bodyguard | 🛡️ |
| Witch | 🧙‍♀️ |
| Hunter | 🏹 |
| Silent Mage | 🤫 |
| Death | 💀 |
| Vote | 🗳️ |
| Warning | ⚠️ |
| Error | ❌ |
| Success | ✅ |
| Role | 🎭 |
| Mystery/transition | 🌑 |

## 7. Message architecture

Every message follows this trace where applicable:

```text
Canonical event → audience → gameplay meaning → tone layer → primary text → optional variant → button → expected action
```

Private role information, action prompts, action results, and investigation results remain private. Public narration must never reveal a hidden role or action unless the canonical game rule explicitly permits it.

## 8. Button rules

Buttons are short, imperative, and machine-backed. Narrative belongs in the message body, not in the button label. Stable examples include `🛡️ Bảo vệ`, `🔮 Điều tra`, `🧪 Cứu`, `☠️ Đầu độc`, `🤫 Làm câm`, `🗳️ Bỏ phiếu`, and `⏭️ Bỏ qua`.

Callback payloads use stable action IDs and target identifiers. A button label must not be used as a domain key, and wording variants must never alter the callback payload.

## 9. Horror intensity and friendliness

Horror should come from silence, uncertainty, footsteps, moonlight, missing voices, and suspicious glances. Death may be atmospheric but must not be graphic, insulting, or needlessly melodramatic. Friendly content means that the bot guides the player, explains the next step, and treats mistakes as recoverable interactions rather than personal failures.

## 10. Message length and mobile readability

System errors should normally be one or two short sentences. Gameplay prompts should present the action before optional flavor. Narrative messages should use short paragraphs and line breaks. Help and role instructions may be longer, but must remain scannable on a mobile screen and stay within Telegram message limits.

## 11. Variation rules

Variants may change wording and atmosphere but must preserve the same event, audience, rule meaning, target restriction, action availability, and outcome. Do not randomize rules, role abilities, win conditions, or eligibility. Variation should be reserved for high-frequency narrative events such as night, dawn, lobby, and game-end announcements.

## 12. Examples and anti-examples

> **Preferred:** 🌙 **Màn đêm buông xuống.** Ngôi làng chìm vào im lặng. Hãy kiểm tra tin nhắn riêng để thực hiện hành động của bạn.

> **Avoid:** 🌙 Bóng tối đang bao trùm tất cả! Hỡi những người dân đáng thương, hãy run sợ trước số phận!

> **Preferred error:** ⚠️ **Khoan đã.** Bạn chưa thể thực hiện hành động này ở giai đoạn hiện tại.

> **Avoid error:** ❌ Mày làm sai rồi, không được làm thế.

> **Preferred death:** 💀 **Một người đã không còn thức dậy.** `{PLAYER}` đã chết và không thể tiếp tục hành động trong ván này.

> **Avoid death:** `{PLAYER}` bị xé xác, máu chảy khắp quảng trường và không còn tồn tại.

## 13. QA checklist

Before shipping content, verify Vietnamese grammar, canonical terminology, audience and visibility, game-state accuracy, target/action clarity, mobile length, emoji consistency, non-graphic horror, friendliness, and whether any variation changes meaning. A message is not approved if a player can read it and misunderstand the action, phase, target restriction, or outcome.
