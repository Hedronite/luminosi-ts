import { presetsByCategory, type Palette, type Preset, type ScenePalette } from "@hedronite/lts-tokens";

const sceneKeys = ["base", "accent", "metal", "glass", "emissive"] as const satisfies readonly (keyof ScenePalette)[];

/** One scheme's colors as a small sample: surfaces, text, a line and the accent with its text. */
function Sample({ palette, label }: { readonly palette: Palette; readonly label: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1.5 p-3" style={{ background: palette.surface, color: palette.fg }}>
      <span className="text-xs uppercase tracking-wide" style={{ color: palette.fgMuted }}>
        {label}
      </span>
      <span className="rounded-md px-2 py-1 text-sm" style={{ background: palette.surfaceRaised, border: `1px solid ${palette.line}` }}>
        Aa
      </span>
      <span className="self-start rounded-md px-2 py-0.5 text-xs font-medium" style={{ background: palette.accent, color: palette.onAccent }}>
        Accent
      </span>
    </span>
  );
}

/** Every look, grouped by where it comes from. Picking one applies it to the catalog. */
export function Looks({ current, onPick }: { readonly current: Preset; readonly onPick: (preset: Preset) => void }) {
  return (
    <section aria-labelledby="looks-title" className="mt-6">
      <h2 id="looks-title" className="text-lg font-semibold">
        Looks
      </h2>
      <p className="mt-1 max-w-prose text-sm text-fg-muted">A look is a set of interface and scene colors that passes WCAG contrast. Pick one to apply it to the whole catalog.</p>
      {presetsByCategory().map(({ category, presets: group }) => (
        <section key={category.id} aria-labelledby={`looks-${category.id}`} className="mt-6">
          <h3 id={`looks-${category.id}`} className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
            {category.name} <span className="font-normal normal-case tracking-normal">· {String(group.length)}</span>
          </h3>
          <p className="mt-0.5 text-sm text-fg-muted">{category.description}</p>
          <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
            {group.map((preset) => (
              <li key={preset.id}>
                <button
                  type="button"
                  aria-pressed={preset.id === current.id}
                  onClick={() => {
                    onPick(preset);
                  }}
                  className="flex w-full flex-col overflow-hidden rounded-xl border border-line text-left hover:border-fg-muted aria-pressed:border-accent aria-pressed:ring-2 aria-pressed:ring-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="flex" aria-hidden="true">
                    {preset.scheme === undefined ? (
                      <>
                        <Sample palette={preset.light} label="Light" />
                        <Sample palette={preset.dark} label="Dark" />
                      </>
                    ) : (
                      <Sample palette={preset.scheme === "dark" ? preset.dark : preset.light} label={preset.scheme === "dark" ? "Dark only" : "Light only"} />
                    )}
                  </span>
                  <span className="flex h-2" aria-hidden="true">
                    {sceneKeys.map((key) => (
                      <span key={key} className="flex-1" style={{ background: preset.scene[key] }} />
                    ))}
                  </span>
                  <span className="flex flex-col px-3 py-2">
                    <span className="font-medium">{preset.name}</span>
                    <span className="text-xs text-fg-muted">
                      {preset.scheme === undefined ? "Follows your light or dark setting" : `${preset.scheme === "dark" ? "Dark" : "Light"} only`}
                      {preset.credit === undefined ? "" : ` · ${preset.credit}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
