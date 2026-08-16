# Sourced by every verification script.
#
# These suites are destructive: they DELETE every queue row, every reveal, and reset every
# PIN to null. That is fine against a scratch database and catastrophic against the one the
# office is using — the queue empties mid-song, everybody's name comes up unclaimed, and
# test songs appear from nowhere. It looks exactly like being hacked.
#
# So running them takes a deliberate act. There is no default that wipes anything.

if [ "${VERIFY_WIPE_OK:-}" != "1" ]; then
  echo
  echo "  Refusing to run: these suites delete the queue, all reveals, and every PIN."
  echo
  echo "  They are safe only against a database nobody is using. If this one is live for"
  echo "  the office, stop — point them at a scratch project instead."
  echo
  echo "  To proceed:  VERIFY_WIPE_OK=1 npm run verify"
  echo
  exit 1
fi
