// Globals baked into every app bundle by bay/scripts/build-app.ts.
// There is no root tsconfig yet; when one appears, including packages/sync/src
// picks this up so apps and the package see the same declaration.

/** Git short sha the bundle was built from; `-dirty` suffix if uncommitted changes. */
declare const GARAGE_BUILD: string;
