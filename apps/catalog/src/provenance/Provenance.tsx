import type { AssetOrigin } from "@hedronite/lts-core";
import { vendorProvenance } from "../generated/vendorProvenance";
import { commitUrl, mergePolicies, policyTitles, shortCommit } from "../vendored";
import { relationWords, sourceOf } from "./provenance";

/**
 * Where an asset came from, in the asset dialog: the relation it stands in, the vendored folder's repository at the pinned commit, the
 * license that path is under beside the folder's own classes, what the folder holds, and what the port changed.
 *
 * It is a chunk of its own, loaded when a dialog opens on an asset that has an origin: the folder provenance it reads is 15 KB, which the
 * gallery's own line cannot carry (R33).
 */
export function Provenance({ origin }: { readonly origin: AssetOrigin }): React.JSX.Element {
  const folder = vendorProvenance[origin.vendor];
  const source = folder === undefined ? undefined : sourceOf(origin, folder);
  const policies = folder === undefined ? [] : mergePolicies(folder.policies);
  return (
    <section aria-label="Provenance" data-testid="dialog-provenance" className="mt-6 text-sm">
      <h3 className="text-sm font-medium">Provenance</h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
        <dt className="text-fg-muted">Credit</dt>
        <dd data-testid="provenance-relation">{relationWords[origin.relation]}</dd>
        <dt className="text-fg-muted">Source</dt>
        <dd data-testid="provenance-source">
          {source === undefined ? (
            "No repository is recorded for this path in the folder's pin"
          ) : (
            <a href={commitUrl(source)} className="break-all text-fg underline decoration-accent decoration-2 underline-offset-2">
              {source.repo.replace(/^https?:\/\/github\.com\//, "")} at {shortCommit(source.commit)}
            </a>
          )}
        </dd>
        <dt className="text-fg-muted">License</dt>
        <dd data-testid="provenance-license">
          {origin.license ?? (folder === undefined ? "—" : folder.license)}
          {policies.length === 0 ? null : (
            <>
              {" · the folder: "}
              {policies.map((policy, index) => (
                <span key={`${policy.class}:${policy.spdx}`}>
                  {index === 0 ? null : " · "}
                  {`${policy.spdx}, ${policyTitles[policy.class]} (${String(policy.fileCount)} files)`}
                </span>
              ))}
            </>
          )}
        </dd>
        {folder === undefined ? null : (
          <>
            <dt className="text-fg-muted">Folder</dt>
            <dd data-testid="provenance-folder">
              {`${String(folder.totalFiles)} files, not counting license and credit files · in the repo since ${folder.vendoredOn}`}
            </dd>
          </>
        )}
        {origin.transformations === undefined || origin.transformations.length === 0 ? null : (
          <>
            <dt className="text-fg-muted">Changed</dt>
            <dd data-testid="provenance-changes">
              <ul role="list" className="flex flex-col gap-1">
                {origin.transformations.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
