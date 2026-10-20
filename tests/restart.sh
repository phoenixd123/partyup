#!/bin/bash
# TEST ONLY: reseed the DB and (re)start the test server
cd "$(dirname "$0")/.."
[ -f /tmp/ts.pid ] && kill "$(cat /tmp/ts.pid)" 2>/dev/null
./tests/reset_db.sh --seed >/dev/null
nohup node tests/test_server.mjs > /tmp/ts.log 2>&1 &
echo $! > /tmp/ts.pid
sleep 1
