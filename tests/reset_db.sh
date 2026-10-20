#!/bin/bash
# TEST ONLY: recreate a local database emulating Supabase and load the schema (+ optional seed)
set -e
export PGHOST=${PGHOST:-/tmp} PGPORT=${PGPORT:-5433} PGUSER=${PGUSER:-postgres}
dropdb --if-exists partyup_test >/dev/null 2>&1
createdb partyup_test
psql -q -v ON_ERROR_STOP=1 -d partyup_test -f "$(dirname "$0")/supabase_stub.sql" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d partyup_test -f "$(dirname "$0")/../supabase/schema.sql"
if [ "$1" == "--seed" ]; then psql -q -v ON_ERROR_STOP=1 -d partyup_test -f "$(dirname "$0")/../supabase/seed_demo.sql"; fi
echo "db ready"
