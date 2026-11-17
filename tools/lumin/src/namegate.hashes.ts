/**
 * Salted SHA-256 hashes of the names that must not appear in tracked text (see `namegate.test.ts`).
 * A token is lowercased, prefixed with `salt` and hashed, so this list never holds a name in clear.
 */
export const salt = "lts-name-gate/1/";

export const hashes: readonly string[] = [
  "f5ce2fa3e8572c362831cb6d32da5c34113f974b82759dab65678a36de5924dc",
  "385937834dba46396256f5c00f5e388a4ca3e0966ff76030adff4adee95b36e0",
  "174ade10153002deda827f73e5028b0fc1938c3576d0abe996979fdd709a3c86",
  "80e0efd95865741547adf58b89e16351f42013041b6e5acf12ffbfb1a6c062b1",
  "e75fe98818626efd92c8c25121035fd1a61e71cee2ffa11b6240bc73581b4a05",
  "e97fb347a8e698fdb21ee53ac9638ebe930da59e96797065b8f67c899fb59cdd",
  "b6fb7baeee498a5fd3cc84d91423451340d9a81f67da786b0f3a82b6b767659f",
  "89d94d057c4c02f94b276c2358fae72886640117261848e18f55426cde33fa69",
  "6f311e85e27c202218c998f05e16296f685999fcd1a1279d14ac7f3fcf6ef4c3",
  "057e77fc2166f1afd8c36189bde4f3178f5f551221466e2dd53c945db9ce89b8",
  "8da9448944e5bac7db35f660eba5aa3dfe2941535375a9f47d37c6fbdb9439bf",
  "33ea2065c7eab4002a52fd9377ed4de58570790ba319717ac29ecb61ae5c1447",
  "ed09e3eab6e9d5d3de368e5c14607ab1c844e3969067affb7663c46443e1075a",
  "180e7cc3f6e318811c32cfc3f8f784cfc24f5d4b8e931342ad31824e6a188e5c",
];

/**
 * A hit that is allowed: one place, keyed by file, line and the hash of the token, so the same word
 * anywhere else (or a different gated word on the same line) still fails. Keep this list short.
 */
export const allowed: readonly { readonly file: string; readonly line: number; readonly hash: string }[] = [];
