#!/usr/bin/env bash
# Run the full Node test suite (no npm deps).
set -e
node --test "$(dirname "$0")"
