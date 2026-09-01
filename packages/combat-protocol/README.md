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

M2C 事件图 V1 已冻结以下运行约束：

- 原始事件与派生事件分别标记 `eventOrigin`；
- 每个事件保存稳定 `eventId`、`rootEventId` 与 `parentEventId`；
- 派生事件保存 `triggerId`、`triggerChain` 与 `derivationDepth`；
- 同一触发器不能在一条派生链中再次触发自身；
- 单触发器扇出、派生深度、总事件数、派生事件数与事件载荷均有服务器硬预算；
- 触发器按照优先级和 ID 稳定排序，完整事件链进入确定性回放哈希。
