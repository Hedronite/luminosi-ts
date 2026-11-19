/** The scene documents the round trip draws, by the name of their file in `packages/scene/fixtures`. */
export const roundTrip = ["primitives-in-materials", "framed-solid-shader", "object-effects-ink", "transform-hierarchy"] as const;

export type Fixture = (typeof roundTrip)[number];
