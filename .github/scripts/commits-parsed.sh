#!/usr/bin/env bash
# Fails a check on the open release pull request when release-please couldn't
# parse a commit. release-please itself succeeds, leaving the commit out of the
# release notes and saying so only in its log: in reelbarrow, which this is
# from, a pull request whose description mentioned the commit-override marker
# vanished from 0.5.0's notes that way. The release pull request is where the
# notes are merged, so the check is there, on its head commit; every run sets
# it, so it passes again on the run after the cause is corrected.
#
# Reads the log of this workflow run's `release-please` job. Needs GH_TOKEN,
# REPO (owner/name), RUN_ID and RUN_ATTEMPT.
set -euo pipefail

run="repos/$REPO/actions/runs/$RUN_ID/attempts/$RUN_ATTEMPT"
run_url="https://github.com/$REPO/actions/runs/$RUN_ID/attempts/$RUN_ATTEMPT"

job=$(gh api "$run/jobs" --jq '.jobs[] | select(.name == "release-please") | .id')
# A finished job's log can take a few seconds to be served.
log=
for _ in 1 2 3 4 5 6; do
	log=$(gh api "repos/$REPO/actions/jobs/$job/logs") && break
	sleep 10
done
test -n "$log"
# Each unparsed commit and release-please's reason, without their timestamps.
unparsed=$(printf '%s\n' "$log" | grep -A1 'commit could not be parsed' | cut -d' ' -f2- || true)

head=$(gh pr list --repo "$REPO" --state open --label 'autorelease: pending' \
	--json headRefOid --jq '.[0].headRefOid // empty')

check() { # state, description (at most 140 characters)
	if [ -n "$head" ]; then
		gh api -X POST "repos/$REPO/statuses/$head" -f state="$1" \
			-f context="release notes: commits parsed" \
			-f description="$2" -f target_url="$run_url" >/dev/null
	fi
}

if [ -z "$unparsed" ]; then
	check success "release-please parsed every commit since the last release"
	exit 0
fi

printf '%s\n' "$unparsed"
check failure "A commit is missing from these notes: correct its pull request, then rerun all of the release run's jobs"
echo "::error::release-please couldn't parse a commit above, so the release notes are missing it. Correct the merged pull request's title or its commit-override block, then rerun all of this workflow's jobs, not only the failed one."
exit 1
