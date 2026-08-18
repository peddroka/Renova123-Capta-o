set -e
set -a
. /opt/evolution-api/.env
set +a
/usr/bin/node /tmp/redis-copy.mjs
