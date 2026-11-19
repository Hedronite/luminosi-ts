// Compares two runs of the still-frame rig: `bun run --filter tool-stills compare <dir> <dir>`.
// Prints one line per asset and exits 1 unless every picture is byte-identical. A picture that differs is measured
// (pixels changed, largest and mean channel difference), so a noise ceiling can be ruled from numbers.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { difference } from "./diff.js";
import { decodePng } from "./png.js";

const [first, second] = process.argv.slice(2);
if (first === undefined || second === undefined) {
  console.error("usage: compare <directory of stills> <directory of stills>");
  process.exit(2);
}

const names = (directory: string): readonly string[] => (existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".png")) : []);
const all = [...new Set([...names(first), ...names(second)])].sort();

let differing = 0;
for (const name of all) {
  const a = join(first, name);
  const b = join(second, name);
  if (!existsSync(a) || !existsSync(b)) {
    differing += 1;
    console.log(`MISSING  ${name}: only in ${existsSync(a) ? first : second}`);
    continue;
  }
  const bytesA = readFileSync(a);
  const bytesB = readFileSync(b);
  if (bytesA.equals(bytesB)) {
    console.log(`same     ${name}`);
    continue;
  }
  differing += 1;
  const found = difference(decodePng(bytesA), decodePng(bytesB));
  console.log(`DIFFERS  ${name}: ${String(found.changedPixels)} of ${String(found.pixels)} pixels, largest channel step ${String(found.maxChannel)}, mean ${found.meanChannel.toFixed(4)}`);
}
console.log(`${String(all.length)} stills compared, ${String(all.length - differing)} identical, ${String(differing)} not`);
process.exit(differing === 0 ? 0 : 1);
