#!/usr/bin/env nu
# Deterministic body for the lumin-new skill: add source assets. Writes files; use only when a human asked.
# Wraps `bun tools/lumin/src/cli.ts new-icon | new-object | review-object`.
#   icon    lumin new-icon ID --name=N --tags=a,b --svg=FILE [--dry-run]
#   object  lumin new-object ID (--from-image=IMG | --from-workspace=DIR) [--name=N --tags=a,b --dry-run]
#   review  lumin review-object --spec=FILE --reference=IMG [--out=DIR --look=L --yaw=D --pitch=D]

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

# Add a stroke icon from an SVG file on the 24-unit grid. Then run `bun run icons`.
def "main icon" [id: string, --name: string = "", --tags: string = "", --svg: string = "", --dry-run] {
  let svg_path = (if ($svg | is-empty) { "" } else { $svg | path expand })
  let base = ([$id] ++ (opt "name" $name) ++ (opt "tags" $tags) ++ (opt "svg" $svg_path))
  finish (lumin "new-icon" (if $dry_run { $base ++ ["--dry-run"] } else { $base }))
}

# Image to library object through the forge. --from-image starts a forge workspace for a photo;
# --from-workspace (once the forge reports action-ready) emits, reviews and adds it. Then `bun run objects`.
def "main object" [id: string, --from-image: string = "", --from-workspace: string = "", --name: string = "", --tags: string = "", --dry-run] {
  let image = (if ($from_image | is-empty) { "" } else { $from_image | path expand })
  let workspace = (if ($from_workspace | is-empty) { "" } else { $from_workspace | path expand })
  let base = ([$id] ++ (opt "from-image" $image) ++ (opt "from-workspace" $workspace) ++ (opt "name" $name) ++ (opt "tags" $tags))
  finish (lumin "new-object" (if $dry_run { $base ++ ["--dry-run"] } else { $base }))
}

# Render an ObjectSpec framed like a reference photo and score it with the forge's review tools.
def "main review" [--spec: string = "", --reference: string = "", --out: string = "", --look: string = "", --yaw: string = "", --pitch: string = ""] {
  let expand = {|p| if ($p | is-empty) { "" } else { $p | path expand } }
  let args = ((opt "spec" (do $expand $spec)) ++ (opt "reference" (do $expand $reference)) ++ (opt "out" (do $expand $out)) ++ (opt "look" $look) ++ (opt "yaw" $yaw) ++ (opt "pitch" $pitch))
  finish (lumin "review-object" $args)
}

def main [] {
  finish { ok: false, command: "lumin-new", error: "usage: nu lumin-new.nu icon ID --name N --tags a,b --svg FILE [--dry-run] | object ID (--from-image IMG | --from-workspace DIR) [--name N --tags a,b --dry-run] | review --spec FILE --reference IMG [--out DIR --look L]", kind: "usage", exit: 2 }
}
