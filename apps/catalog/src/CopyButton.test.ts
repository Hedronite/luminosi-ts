import { describe, expect, it } from "vitest";
import { copyText, type CopyHost } from "./CopyButton";

/** A host whose routes record what they were asked to copy. */
function host(options: { readonly api?: "ok" | "denied" | "throws" | "absent"; readonly exec?: "ok" | "refused" | "throws" }): { readonly host: CopyHost; readonly written: string[]; readonly executed: string[] } {
  const written: string[] = [];
  const executed: string[] = [];
  const api = options.api ?? "absent";
  const exec = options.exec ?? "ok";
  return {
    written,
    executed,
    host: {
      clipboard:
        api === "absent"
          ? undefined
          : {
              writeText: (text) => {
                if (api === "throws") throw new TypeError("clipboard is not available");
                written.push(text);
                return api === "denied" ? Promise.reject(new DOMException("denied", "NotAllowedError")) : Promise.resolve();
              },
            },
      execCopy: (text) => {
        executed.push(text);
        if (exec === "throws") throw new Error("execCommand blew up");
        return exec === "ok";
      },
    },
  };
}

describe("copyText", () => {
  it("uses the clipboard API when the page has one, and goes no further", async () => {
    const run = host({ api: "ok" });
    await expect(copyText("snippet", run.host)).resolves.toBe("copied");
    expect(run.written).toEqual(["snippet"]);
    expect(run.executed).toEqual([]);
  });

  it("falls back to execCommand where there is no clipboard API (plain http://)", async () => {
    const run = host({ api: "absent", exec: "ok" });
    await expect(copyText("snippet", run.host)).resolves.toBe("copied");
    expect(run.executed).toEqual(["snippet"]);
  });

  it("falls back to execCommand when the clipboard API refuses or throws", async () => {
    await Promise.all(
      (["denied", "throws"] as const).map(async (api) => {
        const run = host({ api, exec: "ok" });
        await expect(copyText("snippet", run.host)).resolves.toBe("copied");
        expect(run.executed).toEqual(["snippet"]);
      }),
    );
  });

  it("asks for a manual copy when every route fails, and never throws", async () => {
    const cases = (["absent", "denied", "throws"] as const).flatMap((api) => (["refused", "throws"] as const).map((exec) => ({ api, exec })));
    await Promise.all(cases.map(async ({ api, exec }) => expect(copyText("snippet", host({ api, exec }).host)).resolves.toBe("manual")));
  });
});
