#!/usr/bin/env nu
# Deterministic body for the lumin-scene skill: validate, diff, patch and export LuminosiTS scene documents.
# Wraps `bun tools/lumin/src/cli.ts scene …` and prints the CLI's envelope exactly as the CLI printed it (the same bytes).
#   validate  lumin scene validate FILE
#   diff      lumin scene diff A B
#   patch     lumin scene patch FILE --ops=JSON [--out=PATH --force]
#   export    lumin scene export FILE --as=tsx|vanilla|json|link [--out=PATH --force]
# FILE is a path, or - for stdin (the CLI reads it: pipe the document in).

def repo-root [] { $env.FILE_PWD | path dirname | path dirname | path dirname }

# Print the CLI's own envelope line, untouched, and exit with its code (0 on success).
# Anything that is not an envelope (a crash, a missing bun) becomes one here, so the caller always gets one shape.
def finish [operation: string, args: list<string>] {
  let root = (repo-root)
  let r = (try {
    do { cd $root; ^bun tools/lumin/src/cli.ts scene $operation ...$args | complete }
  } catch {|err|
    { exit_code: 127, stdout: "", stderr: ($err.msg? | default "bun not found"), missing: true }
  })
  let stdout = ($r.stdout? | default "" | str trim)
  let stderr = ($r.stderr? | default "" | str trim)
  let code = ($r.exit_code? | default 127)
  let command = $"scene ($operation)"
  if ($r.missing? | default false) {
    print ({ ok: false, command: $command, error: "bun is not on PATH", kind: "missing_bun", exit: 127 } | to json --raw)
    exit 127
  }
  let candidates = ($stdout | lines | where {|l| $l starts-with "{" })
  let last = (if ($candidates | is-empty) { "" } else { $candidates | last })
  let parsed = (try { $last | from json } catch { null })
  if $parsed == null {
    let raw = ([$stderr $stdout] | str join " " | str trim)
    print ({ ok: false, command: $command, error: ($raw | str substring 0..<400), kind: "failed", exit: (if $code == 0 { 1 } else { $code }) } | to json --raw)
    exit (if $code == 0 { 1 } else { $code })
  }
  print $last
  exit (if ($parsed.ok? | default false) { 0 } else { $parsed.exit? | default $code })
}

# `--flag=value` as one argv entry, so a value starting with "-" is never read as a flag.
def opt [flag: string, value: string] {
  if ($value | is-empty) { [] } else { [$"--($flag)=($value)"] }
}

# The arguments that were given: a missing one is left for the CLI to name ("b is required"), so a slip is an envelope, not a Nushell error.
def given [values: list<any>] {
  $values | where {|v| $v != null }
}

def flag [name: string, on: bool] {
  if $on { [$"--($name)"] } else { [] }
}

# Is a document valid? Its issues with paths, the closest ids for an unknown one; exits 1 when invalid.
def "main validate" [document?: string] {
  finish "validate" (given [$document])
}

# What differs between two documents by node id, and the edit operations that make the first the second.
def "main diff" [a?: string, b?: string] {
  finish "diff" (given [$a $b])
}

# Apply edit operations, in order and all or nothing. --ops is a JSON array of { op, … } edits.
def "main patch" [document?: string, --ops: string = "", --out: string = "", --force] {
  finish "patch" ((given [$document]) ++ (opt "ops" $ops) ++ (opt "out" $out) ++ (flag "force" $force))
}

# A document as React code (tsx), a vanilla module, canonical JSON, or a share link.
def "main export" [document?: string, --as: string = "", --out: string = "", --force] {
  finish "export" ((given [$document]) ++ (opt "as" $as) ++ (opt "out" $out) ++ (flag "force" $force))
}

def main [] {
  print ({ ok: false, command: "lumin-scene", error: "usage: nu lumin-scene.nu (validate|diff|patch|export) …", kind: "usage", exit: 2 } | to json --raw)
  exit 2
}
