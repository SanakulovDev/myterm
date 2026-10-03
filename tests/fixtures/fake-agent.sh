#!/bin/sh
# Fake agent for the launch integration tests.
# Reports what it received, then:
#   --exit N   exits with code N (default 0)
#   --wait     blocks until Ctrl+C (default SIGINT handling, so the shell sees 130)
#   --tick     prints its PID, then FAKE_AGENT_TICK <n> every 0.2s until killed
printf 'FAKE_AGENT_ARGC=%s\n' "$#"
for a in "$@"; do printf 'FAKE_AGENT_ARG=[%s]\n' "$a"; done
printf 'FAKE_AGENT_CWD=[%s]\n' "$(pwd -P)"
printf 'FAKE_AGENT_NONCE=[%s]\n' "${MYTERM_LAUNCH_NONCE-unset}"

code=0
wait=0
tick=0
while [ $# -gt 0 ]; do
  case "$1" in
    --exit) code=$2; shift ;;
    --wait) wait=1 ;;
    --tick) tick=1 ;;
  esac
  shift
done

if [ "$tick" = 1 ]; then
  printf 'FAKE_AGENT_PID=%s\n' "$$"
  n=0
  while :; do
    n=$((n + 1))
    printf 'FAKE_AGENT_TICK %d\n' "$n"
    sleep 0.2
  done
fi

if [ "$wait" = 1 ]; then
  echo FAKE_AGENT_WAITING
  while :; do sleep 0.1; done
fi
exit "$code"
