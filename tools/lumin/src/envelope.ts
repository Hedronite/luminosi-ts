/** What every lumin command prints: success with data, or failure with a reason an agent can act on. */
export type Envelope =
  | { readonly ok: true; readonly command: string; readonly data: unknown }
  | {
      readonly ok: false;
      readonly command: string;
      readonly error: string;
      /** A stable machine-readable reason: usage, unknown_asset, not_built, exists, invalid, failed. */
      readonly kind: string;
      /** The process exit code: 1 for a domain error, 2 for a usage error. */
      readonly exit: number;
      /** For unknown_asset: the closest ids. */
      readonly matches?: readonly string[];
      /** Partial results, such as the steps a failed check did run. */
      readonly data?: unknown;
    };

export const ok = (command: string, data: unknown): Envelope => ({ ok: true, command, data });

export const fail = (command: string, kind: string, error: string, extra: { readonly matches?: readonly string[]; readonly data?: unknown } = {}): Envelope => ({
  ok: false,
  command,
  error,
  kind,
  exit: kind === "usage" ? 2 : 1,
  ...extra,
});
