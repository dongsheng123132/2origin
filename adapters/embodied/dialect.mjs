// Embodied 方言 —— 机器人运行期的可审计语义世界状态。
//
// 它不吃原始像素/点云，也不替代 tf2、SLAM、场景图、MoveIt 或安全控制器。
// 上游感知只向这里提交少量、有业务语义的 observation events；本方言保存事件真源，
// 再用确定性 reducer 生成可随时重建的 current-belief 投影。

export const EVENT_TYPES = [
  'object_observed',
  'contact_started',
  'contact_ended',
  'occlusion_started',
  'occlusion_ended',
  'track_lost',
  'put_inside',
  'removed_from',
  'identity_distinct',
]

export const EPISTEMIC_STATUS = ['observed', 'inferred', 'unknown']

export const OBJECT_ATTRIBUTE_FIELDS = ['exists', 'location']

export const EVENT_CONTRACT = {
  object_observed: ['object', 'attributes'],
  contact_started: ['actor', 'object'],
  contact_ended: ['actor', 'object'],
  occlusion_started: ['object'],
  occlusion_ended: ['object'],
  track_lost: ['object'],
  put_inside: ['object', 'container'],
  removed_from: ['object', 'container', 'location'],
  identity_distinct: ['objects'],
}

/**
 * 五概念自检：
 * - 对象：持久 object ID（与感知 track ID 分离）
 * - 引用：source_id@sha256#t=start,end
 * - 投影：任意时刻可重建的 last_observation + current_belief
 * - 事务：追加一条带证据和三种时间的 observation event
 * - 校验：对象引用、时间、证据范围、字段域和事件负载全部可确定性复核
 */
export const DIALECT = Object.freeze({
  name: 'embodied',
  version: '0.1',
  object: 'persistent object ID',
  reference: 'sensor source fingerprint plus time interval',
  projection: 'last observation and current belief at a requested world time',
  transaction: 'append-only semantic observation event',
  validation: 'reference, time, object, payload and field-domain gates',
})
