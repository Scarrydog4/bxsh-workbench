#!/bin/bash
# 每天备份：数据库 pg_dump + 附件，由 bxsh-workbench-backup.timer 调度。
#
# 附件按周分组：每周第一次备份打全量，之后每天只打新增的（GNU tar 增量）。
# 一周的全量和增量放在同一个目录 files/<年-周>/，删就整组删，
# 所以留下来的每一组都能单独恢复完整附件，不会出现全量被删、只剩增量的情况。
# 数据库保留 14 天；附件保留最近 3 组（当前周 + 前两周，覆盖至少 14 天）。
set -euo pipefail
umask 077
cd "$(dirname "$0")"
DIR=/opt/bxsh-workbench/backups
STAMP=$(date +%Y%m%d-%H%M)
WEEK=$(date +%G-W%V)
mkdir -p "$DIR/db" "$DIR/files/$WEEK"

docker compose exec -T db pg_dump -U bxsh -d workbench -Fc > "$DIR/db/workbench-$STAMP.dump"

# 本周目录里还没有快照文件 = 本周第一次 = 全量
KIND=incr
[ -f "$DIR/files/$WEEK/.snapshot" ] || KIND=full
docker compose run --rm --no-deps --user root -v "$DIR/files/$WEEK:/backup" --entrypoint sh app \
  -c 'umask 077; exec tar --listed-incremental=/backup/.snapshot -czf "$1" -C /data storage' sh "/backup/$STAMP-$KIND.tar.gz"

find "$DIR/db" -name '*.dump' -mtime +14 -delete
# 附件：按组名（年-周）排序，只留最新 3 组
ls -1d "$DIR"/files/*-W*/ 2>/dev/null | sort | head -n -3 | xargs -r rm -rf
echo "备份完成 $STAMP（附件 $KIND）"
