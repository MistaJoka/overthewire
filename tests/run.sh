#!/usr/bin/env bash
# Run the full Node test suite (no npm deps).
# Glob the test files explicitly — `node --test <dir>` is not a directory
# glob on Node >=23 (it tries to resolve the dir as a module entry point).
set -e
node --test "$(dirname "$0")"/*.test.js
