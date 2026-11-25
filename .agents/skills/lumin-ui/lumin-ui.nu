#!/usr/bin/env nu
# Deterministic body for the lumin-ui skill: interface quality, scripted. Every mechanical check lives
# here as data and a pipeline, so the agent reads results, not class strings, and spends its judgment
# only where a script cannot decide (judgment.md beside this file).
#
#   rules     the rule table: id, area, severity, trigger, what, fix
#   scope     what a review covers: base, changed UI files, their added line ranges
#   scan      source checks over JSX (as a table from `lumin ui-facts`) and CSS/HTML text
#   contrast  every text/background token pair the UI uses, in every look and scheme (WCAG ratio)
#   render    the rendered half (`lumin ui-render`): reflow, target size, focus rings, tiny text,
#             measure, motion under reduced motion; needs a running catalog
#   review    all of it merged: one row per rule with every location, status against a base,
#             triggers first and never cut, a cap of 15 rows, coverage and a verdict
#
# Every command prints one JSON line, { ok, command, data } or { ok: false, command, error, kind, exit },
# and exits with `exit`; `review --md` prints Markdown instead. Programs run with argv lists, never a
# shell string. Reads the repository; writes nothing.

def repo-root [] { $env.FILE_PWD | path dirname | path dirname | path dirname }

def finish [e: record] {
  print ($e | to json --raw)
  exit ($e.exit? | default 0)
}

def failure [command: string, kind: string, error: string] {
  { ok: false, command: $command, error: $error, kind: $kind, exit: (if $kind == "usage" { 2 } else { 1 }) }
}

const AREAS = [a11y color type layout motion copy ui slop]
const RANK = { high: 0, medium: 1, low: 2 }

# --- the rules -----------------------------------------------------------------------------------
# Element rules take one row of `lumin ui-facts` (tag, attrs, class, text, iconOnly, children) and say
# whether it breaks the rule. A trigger is HIGH on sight and is never cut from a review.

def has [e: record, name: string] { $name in ($e.attrs | columns) }
def attr [e: record, name: string] { $e.attrs | get --optional $name | default "" | into string }
def tokens [e: record] { $e.class | split row " " | where {|t| $t != "" } }
def base-tokens [e: record] { tokens $e | where {|t| not ($t | str contains ":") } }

const INTERACTIVE = [button a input select textarea summary]
const STATIC_TAGS = [div span li section article p td tr img]
# A Tailwind palette color on any color utility, with any variants: bg-blue-500, hover:text-white, ring-zinc-300/40.
const PRIMITIVE_COLOR = '^([a-z-]+:)*(bg|text|border|ring|outline|fill|stroke|from|to|via|divide|decoration|shadow|caret)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(-[0-9]{2,3})?(/[0-9]+)?$'

def element-rules [] {
  [
    { id: "a11y.pointer-only", area: a11y, severity: high, trigger: true,
      what: "a click handler on an element that is not a control: no keyboard path"
      fix: "use a <button> (or a link); if it must stay, add role, tabIndex={0} and an Enter/Space key handler"
      test: {|e| ($e.tag in $STATIC_TAGS) and (has $e "onClick") and not (has $e "role") and not (has $e "tabIndex") } }
    { id: "a11y.focus-hidden", area: a11y, severity: high, trigger: true,
      what: "the outline is removed with no focus-visible style in its place"
      fix: "keep outline-none only beside a focus-visible:outline-2 (or ring-2) in a focus color"
      test: {|e| ($e.class =~ '(^|\s)(focus:)?outline-(none|hidden)(\s|$)') and not ($e.class =~ 'focus-visible:') } }
    { id: "a11y.focus-not-visible", area: a11y, severity: medium, trigger: false,
      what: "focus styled with focus: rather than focus-visible:, so a mouse click shows it and it competes with hover"
      fix: "use focus-visible: (focus-within: is fine for containers)"
      test: {|e| (tokens $e | any {|t| $t =~ '(^|:)focus:' }) and not ($e.class =~ 'focus-visible:') } }
    { id: "a11y.thin-ring", area: a11y, severity: medium, trigger: false,
      what: "a focus ring under 2px (in Tailwind 4 a bare ring or outline is 1px)"
      fix: "focus-visible:outline-2 or focus-visible:ring-2"
      test: {|e| tokens $e | any {|t| $t =~ '^focus-visible:(ring|ring-1|outline|outline-1)$' } } }
    { id: "a11y.unnamed-control", area: a11y, severity: high, trigger: true,
      what: "an icon-only or empty control with no accessible name"
      fix: "add aria-label (the action, not the icon), or visible text, or sr-only text"
      test: {|e| ($e.tag in [button a]) and ($e.iconOnly or ($e.children == 0 and $e.text == "" and $e.dynamic == 0)) and not ((has $e "aria-label") or (has $e "aria-labelledby") or (has $e "title") or (has $e "{...}") or (has $e "children")) } }
    { id: "a11y.img-alt", area: a11y, severity: high, trigger: true,
      what: "an <img> with no alt at all (a screen reader reads the file name)"
      fix: "alt=\"\" when decorative, else the image's purpose"
      test: {|e| $e.tag == "img" and not (has $e "alt") and not (has $e "{...}") } }
    { id: "a11y.positive-tabindex", area: a11y, severity: medium, trigger: false,
      what: "a positive tabIndex reorders the whole page's tab sequence"
      fix: "tabIndex 0 or -1; fix the order in the DOM"
      test: {|e| (attr $e "tabIndex") =~ '^\{?\s*[1-9]' } }
    { id: "a11y.hidden-focusable", area: a11y, severity: high, trigger: true,
      what: "aria-hidden on a control that can still take focus"
      fix: "remove aria-hidden, or make it inert / tabIndex={-1}"
      test: {|e| ($e.tag in $INTERACTIVE) and ((attr $e "aria-hidden") in ["true" "{true}"]) } }
    { id: "a11y.redundant-role", area: a11y, severity: low, trigger: false,
      what: "a role the native element already has"
      fix: "drop the role"
      test: {|e| ($e.tag == "button" and (attr $e "role") == "button") or ($e.tag == "a" and (attr $e "role") == "link") or ($e.tag == "nav" and (attr $e "role") == "navigation") } }
    { id: "a11y.double-disabled", area: a11y, severity: low, trigger: false,
      what: "both disabled and aria-disabled"
      fix: "one of them: aria-disabled keeps it focusable, disabled removes it"
      test: {|e| (has $e "disabled") and (has $e "aria-disabled") } }
    { id: "a11y.unlabelled-field", area: a11y, severity: medium, trigger: false,
      what: "a field with no id to bind a <label htmlFor>, and no aria name"
      fix: "give it an id and a <label htmlFor>, or wrap it in its label"
      test: {|e| ($e.tag in [input select textarea]) and (attr $e "type") not-in [hidden submit button checkbox radio] and ("label" not-in $e.ancestors) and not ((has $e "id") or (has $e "aria-label") or (has $e "aria-labelledby") or (has $e "{...}")) } }
    { id: "a11y.paste-blocked", area: a11y, severity: medium, trigger: false,
      what: "a paste handler on a field, often blocking paste"
      fix: "never block paste"
      test: {|e| (has $e "onPaste") } }
    { id: "motion.no-reduce", area: motion, severity: high, trigger: true,
      what: "a CSS animation that runs whatever the viewer's reduced-motion setting"
      fix: "motion-safe:animate-…, or a motion-reduce: alternative"
      test: {|e| tokens $e | any {|t| ($t =~ '(^|:)animate-[a-z]') and not ($t =~ 'motion-(safe|reduce):') and not ($t =~ 'animate-none') } } }
    { id: "motion.autorotate", area: motion, severity: high, trigger: true,
      what: "a 3D view that turns by itself with no reduced-motion check in the expression"
      fix: "autoRotate={!reducedMotion}, from matchMedia('(prefers-reduced-motion: reduce)')"
      test: {|e| (has $e "autoRotate") and not ((attr $e "autoRotate") =~ '(?i)reduc|motion') } }
    { id: "color.literal", area: color, severity: medium, trigger: false,
      what: "a raw color in a class or attribute instead of a token"
      fix: "use the semantic token (bg-surface, text-fg-muted, …) or a palette value passed in"
      test: {|e| ((tokens $e | any {|t| $t =~ '\[(#|rgb|hsl|oklch|color\()' })) or ($e.attrs | values | any {|v| ($v | into string) =~ '^#[0-9a-fA-F]{3,8}$' }) } }
    { id: "color.primitive", area: color, severity: medium, trigger: false,
      what: "a Tailwind palette color (bg-blue-500, text-white, …) bypasses the look's tokens"
      fix: "a semantic token (a backdrop: scrim in black or white with opacity is exempt)"
      test: {|e| tokens $e | any {|t| ($t =~ $PRIMITIVE_COLOR) and not ($t =~ '^backdrop:bg-(black|white)/') } } }
    { id: "type.tiny-text", area: type, severity: medium, trigger: false,
      what: "an arbitrary text size under 12px"
      fix: "text-xs (12px) is the floor"
      test: {|e| tokens $e | any {|t|
        let px = ($t | parse --regex 'text-\[(?P<n>[0-9.]+)(?P<u>px|rem)\]')
        if ($px | is-empty) { false } else {
          let n = ($px | first | get n | into float)
          (if ($px | first | get u) == "rem" { $n * 16 } else { $n }) < 12
        } } } }
    { id: "type.off-scale", area: type, severity: low, trigger: false,
      what: "an arbitrary font size or pixel line height off the scale"
      fix: "a step of the type scale; unitless leading"
      test: {|e| tokens $e | any {|t| $t =~ '(^|:)(text-\[[0-9.]+(px|rem)\]|leading-\[[0-9.]+px\])$' } } }
    { id: "type.truncated-unreachable", area: type, severity: medium, trigger: false,
      what: "text cut off with no way to read the rest"
      fix: "a title with the full text, a tooltip, or an expand path"
      test: {|e| (tokens $e | any {|t| $t =~ '^(truncate|line-clamp-[0-9]+)$' }) and not ((has $e "title") or (has $e "aria-label")) } }
    { id: "type.caps-untracked", area: type, severity: low, trigger: false,
      what: "uppercase labels with no letter spacing"
      fix: "tracking-wide (about 0.05em) on small uppercase"
      test: {|e| ("uppercase" in (tokens $e)) and not ($e.class =~ 'tracking-') } }
    { id: "type.justified", area: type, severity: low, trigger: false,
      what: "justified text in an interface"
      fix: "text-start"
      test: {|e| "text-justify" in (tokens $e) } }
    { id: "ui.transition-all", area: ui, severity: medium, trigger: false,
      what: "transition-all animates layout properties too"
      fix: "transition-colors, transition-opacity or transition-transform"
      test: {|e| tokens $e | any {|t| $t =~ '(^|:)transition-all$' } } }
    { id: "ui.will-change", area: ui, severity: low, trigger: false,
      what: "will-change held permanently"
      fix: "set it only while animating, or drop it"
      test: {|e| tokens $e | any {|t| $t =~ '(^|:)will-change-' } } }
    { id: "copy.vague-action", area: copy, severity: medium, trigger: false,
      what: "an action label that does not say what happens"
      fix: "name the result: \"Delete look\", \"Copy snippet\""
      test: {|e| ($e.tag in [button a]) and ($e.text =~ '(?i)^(ok|okay|yes|no|submit|click here|here|go|learn more|read more)$') } }
    { id: "copy.exclaims", area: copy, severity: low, trigger: false,
      what: "an exclamation mark on a control"
      fix: "drop it"
      test: {|e| ($e.tag in [button a]) and ($e.text | str contains "!") } }
    { id: "copy.unhelpful-error", area: copy, severity: medium, trigger: false,
      what: "an error that blames or apologises instead of saying what to do"
      fix: "what happened and the next step"
      test: {|e| $e.text =~ '(?i)\boops\b|something went wrong|\binvalid [a-z]+$' } }
    { id: "copy.punctuation", area: copy, severity: low, trigger: false,
      what: "three dots or a double hyphen in interface text"
      fix: "… (ellipsis) and — or – (dashes)"
      test: {|e| ($e.text | str contains "...") or ($e.text =~ '\w--\w|\s--\s') } }
    { id: "copy.third-person", area: copy, severity: low, trigger: false,
      what: "\"the user\" in interface text"
      fix: "speak to the reader: you"
      test: {|e| $e.text =~ '(?i)\bthe user\b' } }
    # Slop: the decoration a generated interface reaches for. Each rule names a pattern that carries no information; deleted, the page says the same thing.
    { id: "slop.decorative-chip", area: slop, severity: medium, trigger: false,
      what: "a capsule badge with no interaction and no state: decoration in the shape of a control"
      fix: "delete it; capsule and border shapes belong to controls and to real status cells, which carry a role"
      test: {|e| ($e.tag in [span div small]) and (not (has $e "role")) and (not (has $e "onClick")) and ($e.class =~ '(^|\s)rounded-full(\s|$)') and ($e.children == 0) and ($e.text != "") and (($e.text | split row -r '\s+' | where {|w| $w != "" } | length) <= 4) } }
    { id: "slop.fake-cue", area: slop, severity: medium, trigger: false,
      what: "a synthetic cue word (LIVE, SCROLL, NEW, SOON, BETA) standing in for real state"
      fix: "remove it; if the state is real, render it from data in words a screen reader can read"
      test: {|e| ($e.tag in [span div small p b strong em]) and (not (has $e "role")) and (($e.text | str trim | str upcase) in ["LIVE" "SCROLL" "NEW" "SOON" "BETA" "HOT"]) } }
    { id: "slop.decorative-numbering", area: slop, severity: low, trigger: false,
      what: "a heading numbered as decoration (01, [ 01 / 04 ], I.) rather than as a real step"
      fix: "drop the number, or make the sequence an ordered list, where the order means something"
      test: {|e| ($e.tag in [h1 h2 h3 h4 h5 h6]) and ($e.text =~ '^\s*[\[(]?\s*0\d(\s|[/·—–-]|$)|^\s*\[\s*0\d\s*/\s*0\d\s*\]|^\s*[IVX]+\.\s') } }
    { id: "slop.shouted-heading", area: slop, severity: low, trigger: false,
      what: "a heading set in capitals, which shouts and slows reading"
      fix: "sentence case; weight and size carry the hierarchy"
      test: {|e| ($e.tag in [h1 h2 h3 h4 h5 h6]) and ($e.class =~ '(^|\s)uppercase(\s|$)') } }
  ]
}

# Text rules: a regex over the lines of CSS, HTML and Astro files. `unless` is a file-level regex that
# clears the rule for the whole file (the replacement is present).
def text-rules [] {
  [
    { id: "a11y.focus-hidden", area: a11y, severity: high, trigger: true, pattern: 'outline\s*:\s*(none|0)\b', unless: ':focus-visible', skip: ''
      what: "the outline is removed in CSS with no :focus-visible style in the file", fix: "add a :focus-visible outline in a focus color" }
    { id: "a11y.zoom-blocked", area: a11y, severity: high, trigger: true, pattern: 'user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?([^0-9]|$)', unless: '', skip: ''
      what: "the viewport blocks zooming", fix: "width=device-width, initial-scale=1 and nothing more" }
    { id: "motion.no-reduce", area: motion, severity: high, trigger: true, pattern: '@keyframes|animation\s*:', unless: 'prefers-reduced-motion', skip: ''
      what: "a CSS animation with no reduced-motion rule in the file", fix: "wrap it in @media (prefers-reduced-motion: no-preference)" }
    { id: "ui.transition-all", area: ui, severity: medium, trigger: false, pattern: 'transition(-property)?\s*:\s*all\b', unless: '', skip: ''
      what: "transition: all animates layout properties too", fix: "list the properties" }
    { id: "a11y.hover-ungated", area: a11y, severity: low, trigger: false, pattern: ':hover', unless: 'hover:\s*hover', skip: ''
      what: "a :hover style that sticks after a tap on touch screens", fix: "put it under @media (hover: hover)" }
    { id: "color.literal", area: color, severity: medium, trigger: false, pattern: '#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(', unless: '', skip: 'name="theme-color"'
      what: "a raw color in CSS instead of a token", fix: "var(--lts-…) or a theme utility" }
    # Slop in CSS: the two effects a generated page adds when it has nothing to say.
    { id: "slop.gradient-text", area: slop, severity: low, trigger: false, pattern: 'background-clip\s*:\s*text', unless: '', skip: ''
      what: "gradient-filled text: a headline that trades legibility for decoration", fix: "a solid token color for the text; a gradient belongs in a surface behind it" }
    { id: "slop.glow-shadow", area: slop, severity: low, trigger: false, pattern: 'box-shadow\s*:[^;]*\b0\s+0\s+[1-9]\d*px', unless: '', skip: ''
      what: "a neon glow shadow with no offset: light from nowhere, standing in for elevation", fix: "the elevation tokens (shadow-sm, shadow-lg); a glow is an effect, not elevation" }
  ]
}

# --- files and scope -----------------------------------------------------------------------------

const TSX_GLOBS = ["apps/*/src/**/*.tsx" "packages/adapters/src/**/*.tsx"]
const TEXT_GLOBS = ["apps/*/src/**/*.css" "apps/*/index.html" "apps/*/src/**/*.astro"]

def ui-file [path: string] {
  ($path =~ '\.(tsx|css|html|astro)$') and not ($path =~ '(\.test\.tsx|/generated/|/dist/|node_modules)')
}

def rel [root: string, path: string] {
  try { $path | path relative-to $root } catch { $path }
}

def default-files [root: string] {
  cd $root
  ($TSX_GLOBS ++ $TEXT_GLOBS) | each {|g| glob $g } | flatten | each {|p| rel $root $p } | where {|p| ui-file $p } | uniq | sort
}

def git-out [root: string, args: list<string>] {
  let r = (do { cd $root; ^git ...$args | complete })
  if $r.exit_code != 0 { error make { msg: ($r.stderr | str trim) } }
  $r.stdout
}

# The added line ranges of one file since `base` (the whole file when it is untracked).
def added-ranges [root: string, base: string, file: string, untracked: list<string>] {
  if $file in $untracked { return [[start end]; [1 1000000]] }
  git-out $root [diff "-U0" $base "--" $file] | lines | where {|l| $l starts-with "@@" }
  | parse --regex '\+(?P<start>[0-9]+)(,(?P<count>[0-9]+))?'
  | each {|h|
      let start = ($h.start | into int)
      let count = (if ($h.count | is-empty) { 1 } else { $h.count | into int })
      { start: $start, end: ($start + $count - 1), count: $count }
    }
  | where count > 0 | select start end
}

def scope-of [root: string, against: string] {
  let base = (git-out $root [merge-base $against HEAD] | str trim)
  let tracked = (git-out $root [diff "--name-only" $base] | lines)
  let untracked = (git-out $root [ls-files "--others" "--exclude-standard"] | lines)
  let files = ($tracked ++ $untracked | uniq | where {|f| (ui-file $f) and ($root | path join $f | path exists) } | sort)
  {
    against: $against
    base: $base
    head: (git-out $root [rev-parse --short HEAD] | str trim)
    files: ($files | each {|f| { file: $f, untracked: ($f in $untracked), added: (added-ranges $root $base $f $untracked) } })
    excluded: ($tracked ++ $untracked | uniq | where {|f| not (ui-file $f) } | length)
  }
}

# --- running the checks --------------------------------------------------------------------------

# The lumin CLI from the repository root; its JSON envelope's data, or an error.
def lumin-data [root: string, args: list<string>] {
  let r = (try { do { cd $root; ^bun tools/lumin/src/cli.ts ...$args | complete } } catch {|err| { exit_code: 127, stdout: "", stderr: ($err.msg? | default "bun not found") } })
  let candidates = ($r.stdout | lines | where {|l| $l starts-with "{" })
  let line = (if ($candidates | is-empty) { "" } else { $candidates | last })
  let doc = (try { $line | from json } catch { null })
  if $doc == null { error make { msg: $"lumin ($args | first) failed: ($r.stderr | str trim | str substring 0..<300)" } }
  if not $doc.ok { error make { msg: $"lumin ($args | first): ($doc.error)" } }
  $doc.data
}

def finding [rule: record, file: string, line: int, excerpt: string] {
  { rule: $rule.id, area: $rule.area, severity: $rule.severity, trigger: $rule.trigger, file: $file, line: $line, what: $rule.what, fix: $rule.fix, excerpt: ($excerpt | str trim | str substring 0..<120) }
}

def scan-files [root: string, files: list<string>] {
  let tsx = ($files | where {|f| $f ends-with ".tsx" })
  let texts = ($files | where {|f| not ($f ends-with ".tsx") })
  let facts = (if ($tsx | is-empty) { [] } else { lumin-data $root ([ui-facts] ++ ($tsx | each {|f| $root | path join $f })) })
  let from_jsx = (element-rules | each {|rule|
    $facts | where {|e| do $rule.test $e } | each {|e| finding $rule (rel $root $e.file) $e.line $"<($e.tag) ($e.class)> ($e.text)" }
  } | flatten)
  let from_text = ($texts | each {|f|
    let body = (open --raw ($root | path join $f))
    text-rules | where {|r| ($r.unless == "") or not ($body =~ $r.unless) } | each {|rule|
      $body | lines | enumerate | where {|l| ($l.item =~ $rule.pattern) and ($rule.skip == "" or not ($l.item =~ $rule.skip)) } | each {|l| finding $rule $f ($l.index + 1) $l.item }
    } | flatten
  } | flatten)
  $from_jsx ++ $from_text
}

# Marks each finding introduced (on an added line) or pre-existing, against a scope.
def with-status [scope: record] {
  let items = $in
  let added = ($scope.files | reduce --fold {} {|f, acc| $acc | insert $f.file $f.added })
  $items | each {|x|
    let ranges = ($added | get --optional $x.file | default [])
    let hit = ($ranges | any {|r| $x.line >= $r.start and $x.line <= $r.end })
    $x | insert status (if $hit { "introduced" } else { "pre-existing" })
  }
}

# --- contrast ------------------------------------------------------------------------------------

def channel [hex2: string] {
  # "0x" first: with --radix 16 a pair like "0b" reads as a binary prefix.
  let c = (($"0x($hex2)" | into int) / 255.0)
  if $c <= 0.03928 { $c / 12.92 } else { (($c + 0.055) / 1.055) ** 2.4 }
}

def luminance [hex: string] {
  let h = ($hex | str substring 1..)
  0.2126 * (channel ($h | str substring 0..<2)) + 0.7152 * (channel ($h | str substring 2..<4)) + 0.0722 * (channel ($h | str substring 4..<6))
}

def ratio [a: string, b: string] {
  let la = (luminance $a)
  let lb = (luminance $b)
  let hi = ([$la $lb] | math max)
  let lo = ([$la $lb] | math min)
  (($hi + 0.05) / ($lo + 0.05)) | math round --precision 2
}

# Every look's interface colors, one row per look and scheme, from the theme CSS the tokens package emits.
def palettes [root: string] {
  let css = (do { cd $root; ^bun -e 'import { themeCss } from "./packages/tokens/src/css.ts"; import { presets } from "./packages/tokens/src/presets.ts"; process.stdout.write(themeCss(presets));' | complete })
  if $css.exit_code != 0 { error make { msg: $"could not build the theme CSS: ($css.stderr | str trim | str substring 0..<300)" } }
  $css.stdout
  | parse --regex '(?s)(?P<media>@media \(prefers-color-scheme: dark\) \{\s*)?:root[^{]*?data-preset="(?P<look>[^"]+)"[^{]*\{(?P<body>[^}]*)\}'
  | each {|b|
      let scheme = (if ($b.media | is-not-empty) { "dark" } else if ($b.body =~ 'color-scheme:\s*dark;') { "dark" } else { "light" })
      let colors = ($b.body | parse --regex '--lts-(?P<k>[a-z-]+):\s*(?P<v>#[0-9a-fA-F]{6})' | reduce --fold {} {|it, acc| $acc | upsert $it.k ($it.v | str downcase) })
      { look: $b.look, scheme: $scheme, colors: $colors }
    }
}

const TOKEN_NAMES = [surface surface-raised fg fg-muted line accent on-accent]

def token-of [ts: list<string>, prefix: string] {
  let hits = ($ts | where {|t| $t starts-with $"($prefix)-" } | each {|t| $t | str substring ($prefix | str length | $in + 1).. } | where {|n| $n in $TOKEN_NAMES })
  if ($hits | is-empty) { null } else { $hits | first }
}

# Text and focus-ring color pairs as the UI uses them: an element's base text-* token on its own bg-*,
# else the nearest ancestor's in the same file, else the page surface.
def color-pairs [root: string, files: list<string>] {
  let tsx = ($files | where {|f| $f ends-with ".tsx" })
  if ($tsx | is-empty) { return [] }
  let facts = (lumin-data $root ([ui-facts] ++ ($tsx | each {|f| $root | path join $f })))
  $facts | group-by file | values | each {|rows|
    $rows | each {|e|
      let own = (base-tokens $e)
      let fg = (token-of $own "text")
      let ring = (tokens $e | where {|t| $t =~ '^focus-visible:(outline|ring)-[a-z-]+$' } | each {|t| $t | str replace -r '^focus-visible:(outline|ring)-' '' } | where {|n| $n in $TOKEN_NAMES } | get --optional 0)
      if $fg == null and $ring == null { return [] }
      # The nearest painted background: its own, else up the ancestors in this file, else the page.
      mut bg = (token-of $own "bg")
      mut at = $e.parent
      while $bg == null and $at >= 0 {
        let p = ($rows | get $at)
        $bg = (token-of (base-tokens $p) "bg")
        $at = $p.parent
      }
      # An offset ring is drawn outside the element, over what is behind it: its parent's background.
      let offset = ($e.class =~ '(^|\s)focus-visible:(outline-offset|ring-offset)-[1-9]')
      mut behind = null
      mut up = $e.parent
      while $behind == null and $up >= 0 {
        let p = ($rows | get $up)
        $behind = (token-of (base-tokens $p) "bg")
        $up = $p.parent
      }
      let back = ($bg | default "surface")
      let ring_back = (if $offset { $behind | default "surface" } else { $back })
      let size = ($own | where {|t| $t =~ '^text-(xs|sm|base|lg|xl|[2-9]xl)$' } | get --optional 0 | default "text-base")
      let bold = ($own | any {|t| $t in [font-semibold font-bold font-extrabold font-black] })
      let large = ($size =~ 'text-[2-9]xl') or ($size == "text-xl" and $bold)
      let place = $"(rel $root $e.file):($e.line)"
      let text_pair = (if $fg == null { [] } else { [{ fg: $fg, bg: $back, kind: (if $large { "large text" } else { "text" }), min: (if $large { 3.0 } else { 4.5 }), where: $place, assumed: ($bg == null) }] })
      let ring_pair = (if $ring == null { [] } else { [{ fg: $ring, bg: $ring_back, kind: "focus ring", min: 3.0, where: $place, assumed: (if $offset { $behind == null } else { $bg == null }) }] })
      $text_pair ++ $ring_pair
    } | flatten
  } | flatten
}

def contrast-of [root: string, files: list<string>, look: string] {
  let every = (palettes $root)
  let looks = ($every | where {|p| $look == "" or $p.look == $look })
  let pairs = (color-pairs $root $files)
  let default_look = ($every | first | get look)
  $pairs | group-by {|p| $"($p.fg)|($p.bg)|($p.kind)" } | transpose key items | each {|g|
    let p = ($g.items | first)
    let checks = ($looks | each {|l|
      let a = ($l.colors | get --optional $p.fg)
      let b = ($l.colors | get --optional $p.bg)
      if $a == null or $b == null { null } else { { look: $l.look, scheme: $l.scheme, ratio: (ratio $a $b) } }
    } | compact)
    if ($checks | is-empty) { return null }
    let failing = ($checks | where {|c| $c.ratio < $p.min })
    let worst = ($checks | sort-by ratio | first)
    {
      fg: $p.fg, bg: $p.bg, kind: $p.kind, min: $p.min
      worst: $worst.ratio, worst_in: $"($worst.look) ($worst.scheme)"
      failing: ($failing | length), of: ($checks | length)
      failing_default: ($failing | any {|c| $c.look == $default_look })
      failing_looks: ($failing | each {|c| $"($c.look) ($c.scheme)" } | first 8)
      uses: ($g.items | length), where: ($g.items | get where | uniq | first 5)
      assumed_page: ($g.items | all {|i| $i.assumed })
    }
  } | compact | sort-by worst
}

# Failing pairs as findings, so a review can rank them with the rest.
def contrast-findings [rows: list] {
  $rows | where failing > 0 | each {|c|
    let sev = (if $c.failing_default and $c.kind != "focus ring" { "high" } else { "medium" })
    $c.where | each {|w|
      let place = ($w | split row ":")
      {
        rule: "color.contrast", group: $"color.contrast ($c.kind): ($c.fg) on ($c.bg)", area: color, severity: $sev, trigger: ($sev == "high")
        file: ($place | first), line: ($place | last | into int)
        what: $"($c.kind) ($c.fg) on ($c.bg) falls to ($c.worst):1 in ($c.worst_in), under ($c.min):1; fails in ($c.failing) of ($c.of) look schemes: ($c.failing_looks | str join ', ')"
        fix: "a stronger token for this pair, or adjust the look's colors in tokens (the converter reports moves)"
        excerpt: ""
      }
    }
  } | flatten
}

# --- render --------------------------------------------------------------------------------------

def render-findings [root: string, url: string, views: string] {
  let args = ([ui-render $"--url=($url)"] ++ (if $views == "" { [] } else { [$"--views=($views)"] }))
  lumin-data $root $args | each {|f|
    { rule: $f.rule, area: $f.area, severity: $f.severity, trigger: ($f.severity == "high"), file: $"view:($f.view)@($f.width)", line: 0, what: $f.detail, fix: (render-fix $f.rule), excerpt: $f.target }
  }
}

def render-fix [rule: string] {
  match $rule {
    "layout.reflow" => "find the element wider than the screen: min-w-0 on flex children, break-words on long strings, overflow-x-auto on tables and code"
    "a11y.target-size" => "at least 24x24px of hit area (44 on touch): padding, or a pseudo-element that extends the hit area"
    "a11y.unnamed-control" => "aria-label, visible text or sr-only text"
    "a11y.focus-hidden" => "a focus-visible outline or ring, 2px, in a focus color"
    "type.tiny-text" => "12px floor"
    "type.measure" => "max-w-prose (about 65ch) on running text"
    "motion.ignores-reduce" => "read prefers-reduced-motion and stop: a still frame for canvases, motion-safe: for CSS"
    _ => ""
  }
}

# --- review --------------------------------------------------------------------------------------

def rows-of [findings: list] {
  $findings | group-by {|f| $f.group? | default $f.rule } | transpose rule items | each {|g|
    let items = $g.items
    let top = ($items | sort-by {|i| $RANK | get $i.severity } | first)
    let introduced = ($items | any {|i| ($i.status? | default "introduced") == "introduced" })
    {
      rule: $g.rule, area: $top.area, severity: $top.severity, trigger: ($items | any {|i| $i.trigger })
      status: (if $introduced { "introduced" } else { "pre-existing" })
      count: ($items | length)
      where: ($items | each {|i| if $i.line == 0 { $"($i.file) ($i.excerpt)" } else { $"($i.file):($i.line)" } } | uniq | first 8)
      what: $top.what, fix: $top.fix
    }
  } | sort-by {|r| ((if $r.trigger { 0 } else { 1 }) * 10000) + (($RANK | get $r.severity) * 1000) - $r.count }
}

def review-of [root: string, against: string, url: string, views: string] {
  let scope = (if $against == "" { null } else { scope-of $root $against })
  let files = (if $scope == null { default-files $root } else { $scope.files | get file })
  let source = (scan-files $root $files)
  let contrast = (contrast-findings (contrast-of $root $files ""))
  let rendered = (if $url == "" { [] } else { render-findings $root $url $views })
  let all = ($source ++ $contrast ++ $rendered)
  let all = (if $scope == null { $all | each {|x| $x | insert status "introduced" } } else { $all | with-status $scope })
  let rows = (rows-of $all)
  let mine = ($rows | where status == "introduced")
  let theirs = ($rows | where status == "pre-existing")
  let triggers = ($mine | where trigger)
  let rest = ($mine | where {|r| not $r.trigger })
  let room = ([0 (15 - ($triggers | length))] | math max)
  let shown = ($triggers ++ ($rest | first $room))
  let coverage = ($AREAS | each {|a|
    let n = ($mine | where area == $a | length)
    { area: $a, rows: $n, state: (if $n > 0 { "findings" } else { "clear" }) }
  })
  {
    scope: (if $scope == null { { mode: "audit", files: ($files | length) } } else { { mode: "diff", against: $against, base: $scope.base, head: $scope.head, files: ($files | length), excluded: $scope.excluded } })
    verdict: (if ($shown | any {|r| $r.severity == "high" }) { "block" } else { "approve" })
    findings: $shown
    cut: (($mine | length) - ($shown | length))
    pre_existing: ($theirs | first 3)
    coverage: $coverage
    not_verified: (if $url == "" { ["rendered checks (reflow at 320px, target size, focus rings, tiny text, measure, motion under reduced motion): pass --url"] } else { [] })
    judgment: ($coverage | where state == "findings" | get area | append "layout" | uniq)
  }
}

def review-md [r: record] {
  let scope = (if $r.scope.mode == "diff" { $"Diff against ($r.scope.against) \(base ($r.scope.base | str substring 0..<8), head ($r.scope.head)\), ($r.scope.files) UI files" } else { $"Whole-interface audit, ($r.scope.files) UI files" })
  let table = ($r.findings | each {|f| { Severity: ($f.severity | str upcase), Rule: $f.rule, Where: ($f.where | first 3 | str join "<br>"), Count: $f.count, What: $f.what, Fix: $f.fix } })
  [
    "# lumin-ui review" ""
    $"Scope: ($scope). Verdict: **($r.verdict)**." ""
    (if ($table | is-empty) { "No actionable findings." } else { $table | to md })
    ""
    (if $r.cut > 0 { $"($r.cut) lower-ranked rows cut by the cap of 15 \(triggers are never cut\)." } else { "" })
    ""
    "## Coverage" ""
    ($r.coverage | to md)
    ""
    ($r.not_verified | each {|n| $"Not verified: ($n)." } | str join "\n")
    ""
    $"Judgment pass: read judgment.md for ($r.judgment | str join ', ')."
  ] | str join "\n"
}

# --- commands ------------------------------------------------------------------------------------

def csv-list [s: string] { $s | split row "," | each {|x| $x | str trim } | where {|x| $x != "" } }

def run [command: string, body: closure] {
  try { { ok: true, command: $command, data: (do $body) } } catch {|err| failure $command "failed" ($err.msg | str substring 0..<400) }
}

# The rule table, optionally one area.
def "main rules" [--area: string = ""] {
  let wanted = (csv-list $area)
  let all = ((element-rules | each {|r| $r | reject test | insert source "jsx" }) ++ (text-rules | each {|r| $r | reject pattern unless skip | insert source "css/html" }))
  finish { ok: true, command: "rules", data: ($all | where {|r| ($wanted | is-empty) or $r.area in $wanted } | uniq-by id source) }
}

# What a review against REF covers: base, head, the UI files changed and their added line ranges.
def "main scope" [--against: string = "origin/main"] {
  let root = (repo-root)
  finish (run "scope" { scope-of $root $against })
}

# Source findings: the JSX rules over the elements table, and the text rules over CSS and HTML.
# Default: every UI file. --against REF: the changed ones, each finding marked introduced or pre-existing.
def "main scan" [--against: string = "", --area: string = "", ...paths: string] {
  let root = (repo-root)
  if (not ($paths | is-empty)) and $against != "" { finish (failure "scan" "usage" "give paths or --against, not both") }
  finish (run "scan" {
    let scope = (if $against == "" { null } else { scope-of $root $against })
    let files = (if not ($paths | is-empty) { $paths | each {|p| rel $root ($p | path expand) } } else if $scope == null { default-files $root } else { $scope.files | get file })
    let found = (scan-files $root $files)
    let found = (if $scope == null { $found } else { $found | with-status $scope })
    let wanted = (csv-list $area)
    let found = ($found | where {|f| ($wanted | is-empty) or $f.area in $wanted })
    { files: ($files | length), findings: ($found | sort-by {|f| $"(($RANK | get $f.severity))|($f.file)|($f.line | fill --alignment right --character '0' --width 6)" }) }
  })
}

# Contrast of every text and focus-ring token pair the UI uses, in every look and scheme (or one --look).
def "main contrast" [--look: string = "", --failing, ...paths: string] {
  let root = (repo-root)
  finish (run "contrast" {
    let files = (if ($paths | is-empty) { default-files $root } else { $paths | each {|p| rel $root ($p | path expand) } })
    let rows = (contrast-of $root $files $look)
    if $failing { $rows | where failing > 0 } else { $rows }
  })
}

# The rendered checks against a running catalog (bun run --filter catalog preview, or the container).
def "main render" [--url: string = "http://localhost:4173", --views: string = ""] {
  let root = (repo-root)
  let up = (try { http get --max-time 5sec $url | ignore; true } catch { false })
  if not $up { finish (failure "render" "no_server" $"nothing answers at ($url): start the catalog \(bun run build, then bun run --filter catalog preview\) or pass --url") }
  finish (run "render" { render-findings $root $url $views })
}

# Everything merged into one review. --against REF reviews a change; without it, the whole interface.
# --url adds the rendered checks. --md prints the report as Markdown instead of the envelope.
def "main review" [--against: string = "", --url: string = "", --views: string = "", --md] {
  let root = (repo-root)
  if $url != "" {
    let up = (try { http get --max-time 5sec $url | ignore; true } catch { false })
    if not $up { finish (failure "review" "no_server" $"nothing answers at ($url)") }
  }
  let r = (run "review" { review-of $root $against $url $views })
  if $md and $r.ok { print (review-md $r.data); exit 0 }
  finish $r
}

def main [] {
  finish (failure "lumin-ui" "usage" "subcommands: rules | scope | scan | contrast | render | review")
}
