-- 交付与工资脱钩后不再有「待发客户」：已交付过的回到已交付，否则回到未交付。
WITH changed AS (
  UPDATE orders o
  SET status = CASE WHEN o.draft_at IS NOT NULL THEN '已交付' ELSE '未交付' END, updated_at = now()
  WHERE o.status = '待发客户'
  RETURNING o.id, o.no, o.status
)
INSERT INTO audit (actor_id, action, object_type, object_id, object_label, field, from_value, to_value, note)
SELECT 'system', '修改', 'order', id, no, '订单状态', '待发客户', status, '交付统一为一个按钮，取消待发客户状态'
FROM changed;
