# 战斗协议

协议层负责稳定事件类型和版本，不包含职业结算逻辑。

首批事件建议：

- `battle_init`
- `skill_cast_committed`
- `skill_replaced`
- `resource_changed`
- `state_changed`
- `damage_applied`
- `healing_applied`
- `derived_event`
- `battle_result`
- `reward_applied`

二进制 WebSocket 帧继续保留协议版本、消息类型和 Schema 版本；具体字段在 M2 锁定。
