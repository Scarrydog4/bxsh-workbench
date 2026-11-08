-- 只作废系统草稿；手工草稿及所有历史已发流水保持原样。
WITH retired AS (
  UPDATE settle_batches
  SET status = '已作废', voided_at = now(), voided_by = 'system',
      note = concat_ws('；', nullif(note, ''), '改为收入页直接发放')
  WHERE created_by = 'system' AND status = '草稿'
  RETURNING id, no
), void_lines AS (
  UPDATE settlements SET status = '已作废'
  WHERE status = '草稿' AND batch_id IN (SELECT id FROM retired)
)
INSERT INTO audit (actor_id, action, object_type, object_id, object_label, from_value, to_value, note)
SELECT 'system', '作废结算单', 'settle', id, no, '草稿', '已作废', '改为收入页直接发放'
FROM retired;
