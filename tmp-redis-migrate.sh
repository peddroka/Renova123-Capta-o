set -e
sudo redis-server --port 6380 --bind 127.0.0.1 --dir /tmp --dbfilename old-redis-dump.rdb --save "" --appendonly no --daemonize yes --pidfile /tmp/redis-old.pid --logfile /tmp/redis-old.log
sleep 2
redis-cli -p 6380 ping
redis-cli -p 6380 dbsize
redis-cli -p 6380 --scan | head -80
