#!/usr/bin/env nu
# Deterministic body for the lumin-check skill: run the gate and get one summary.
# Wraps `bun tools/lumin/src/cli.ts check`. Steps, in CI order:
#   icons:check typecheck build validate test lint boundaries knip e2e
# Each step reports ok, milliseconds and the last 15 lines of its output.

def repo-root [] { $env.FILE_PWD | path dirname | path dirname | path dirname }

# Print the envelope and exit with its code (0 on success).
def finish [e: record] {
  print ($e | to json --raw)
  exit ($e.exit? | default 0)
}

# Run the lumin CLI from the repository root. It prints one JSON envelope; anything else
# (a crash, a missing bun) becomes an envelope here, so the caller always gets one shape.
def lumin [command: string, args: list<string>] {
  let root = (repo-root)
  let r = (try {
    do { cd $root; ^bun tools/lumin/src/cli.ts $command ...$args | complete }
  } catch {|err|
    { exit_code: 127, stdout: "", stderr: ($err.msg? | default "bun not found"), missing: true }
  })
  let stdout = ($r.stdout? | default "" | str trim)
  let stderr = ($r.stderr? | default "" | str trim)
  let code = ($r.exit_code? | default 127)
  if ($r.missing? | default false) {
    return { ok: false, command: $command, error: "bun is not on PATH", stderr: ($stderr | str substring 0..<400), kind: "missing_bun", exit: 127 }
  }
  let candidates = ($stdout | lines | where {|l| $l starts-with "{" })
  let last = (if ($candidates | is-empty) { "" } else { $candidates | last })
  let parsed = (try { $last | from json } catch { null })
  if $parsed == null {
    let raw = ([$stderr $stdout] | str join " " | str trim)
    return { ok: false, command: $command, error: ($raw | str substring 0..<400), stderr: ($stderr | str substring 0..<400), kind: "failed", exit: (if $code == 0 { 1 } else { $code }) }
  }
  if ($parsed.ok? | default false) { $parsed | upsert exit 0 } else { $parsed | upsert exit ($parsed.exit? | default $code) }
}

# `--flag=value` as one argv entry, so a value starting with "-" is never read as a flag.
def opt [flag: string, value: string] {
  if ($value | is-empty) { [] } else { [$"--($flag)=($value)"] }
}

# Run every step, or --only a comma-separated subset. Stops at the first failure unless --keep-going.
def main [--only: string = "", --keep-going] {
  let base = (opt "only" $only)
  finish (lumin "check" (if $keep_going { $base ++ ["--keep-going"] } else { $base }))
}
