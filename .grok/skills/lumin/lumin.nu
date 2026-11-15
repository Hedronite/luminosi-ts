#!/usr/bin/env nu
# Deterministic body for the lumin skill: find and read LuminosiTS assets.
# Wraps `bun tools/lumin/src/cli.ts` (JSON envelopes). Needs `nu` and `bun`; run `bun run build` once first.
#
# CLI each command runs:
#   search      lumin search QUERY [--kind=K] [--limit=N]
#   show        lumin show ID
#   list        lumin list [--kind=K] [--package=P] [--tag=T] [--limit=N] [--newest]
#   kinds       lumin kinds
#   packages    lumin packages
#   budgets     lumin budgets
#   boundaries  lumin boundaries [--package=P]

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

# Find assets by name, id or tag, best match first.
def "main search" [query: string, --kind: string = "", --limit: int = 10] {
  finish (lumin "search" ([$query] ++ (opt "kind" $kind) ++ [$"--limit=($limit)"]))
}

# One asset: metadata, its package, and copy-ready snippets.
def "main show" [id: string] {
  finish (lumin "show" [$id])
}

# Assets, filtered. --newest sorts by the day added.
def "main list" [--kind: string = "", --package: string = "", --tag: string = "", --limit: int = 50, --newest] {
  let base = ((opt "kind" $kind) ++ (opt "package" $package) ++ (opt "tag" $tag) ++ [$"--limit=($limit)"])
  finish (lumin "list" (if $newest { $base ++ ["--newest"] } else { $base }))
}

# How many assets of each kind.
def "main kinds" [] {
  finish (lumin "kinds" [])
}

# Every package: exports, summary, and the assets it ships.
def "main packages" [] {
  finish (lumin "packages" [])
}

# Pipeline output against assets/budgets.json (after a build).
def "main budgets" [] {
  finish (lumin "budgets" [])
}

# Which package may import which, from .dependency-cruiser.cjs.
def "main boundaries" [--package: string = ""] {
  finish (lumin "boundaries" (opt "package" $package))
}

def main [] {
  finish { ok: false, command: "lumin", error: "usage: nu lumin.nu (search|show|list|kinds|packages|budgets|boundaries) …", kind: "usage", exit: 2 }
}
