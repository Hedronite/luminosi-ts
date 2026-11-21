#!/usr/bin/env nu
# Deterministic body for the lumin-adopt skill: learn from vendored open-source work and port it.
# Wraps `bun tools/lumin/src/cli.ts study | adopt | adopt-skill`. study reads; adopt and adopt-skill write.
#   study  lumin study VENDOR[/PATH] [--limit=N]
#   adopt  lumin adopt VENDOR/PATH --as=KIND --id=ID [--name=N --dry-run]
#   skill  lumin adopt-skill VENDOR/SKILL-DIR [--dry-run --force]
#   fetch  lumin vendor fetch [FOLDER...] [--force]   the raw upstream files, by pin, into the cache (.vendor/)
#   verify lumin vendor verify [FOLDER...]            the cached files' hashes, offline

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

# What a vendored folder or module holds: roles, techniques, packages, and what could be ported.
def "main study" [target: string, --limit: int = 25] {
  finish (lumin "study" [$target $"--limit=($limit)"])
}

# Plan porting a vendored module into the library (--dry-run), or open its workspace in .adopt/ID.
def "main adopt" [target: string, --as: string = "", --id: string = "", --name: string = "", --dry-run] {
  let base = ([$target] ++ (opt "as" $as) ++ (opt "id" $id) ++ (opt "name" $name))
  finish (lumin "adopt" (if $dry_run { $base ++ ["--dry-run"] } else { $base }))
}

# Adopt a vendored agent skill into .agents/skills with its license and credit. Then scripts/sync-skills.
def "main skill" [target: string, --dry-run, --force] {
  let base = ([$target] ++ (if $force { ["--force"] } else { [] }))
  finish (lumin "adopt-skill" (if $dry_run { $base ++ ["--dry-run"] } else { $base }))
}

# Fetch the vendored folders' raw upstream files by their pins into the cache. Network, and only when run; no folder named means all.
def "main fetch" [...folders: string, --force] {
  finish (lumin "vendor" (["fetch"] ++ $folders ++ (if $force { ["--force"] } else { [] })))
}

# Recompute the hash of each cached folder against its pin, offline.
def "main verify" [...folders: string] {
  finish (lumin "vendor" (["verify"] ++ $folders))
}

def main [] {
  finish { ok: false, command: "lumin-adopt", error: "subcommands: study | adopt | skill | fetch | verify", kind: "usage", exit: 2 }
}
