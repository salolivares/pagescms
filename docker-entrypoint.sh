#!/bin/sh
set -e

echo "Running database migrations..."
node db/migrate.mjs

echo "Starting Pages CMS..."
exec node server.js
