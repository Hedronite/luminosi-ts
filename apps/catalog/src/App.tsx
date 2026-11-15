import { createRegistry } from "@hedronite/lts-core";

// Packages register their assets here as they land (Stage 1 onward).
const registry = createRegistry();

export function App() {
  const assets = registry.list();

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">LuminosiTS catalog</h1>
      {assets.length === 0 ? (
        <p className="mt-4 text-neutral-500">No assets yet. They appear here as packages register them.</p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {assets.map((asset) => (
            <li key={asset.id} className="rounded border border-neutral-300 p-4">
              {asset.name}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
