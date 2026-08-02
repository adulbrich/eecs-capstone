/**
 * SVGO config for the institution mark.
 *
 * Verified against svgo 4.0.2. Reproduce with the version pinned, since a
 * major-version jump has already silently broken this file once:
 *
 *   npx --yes svgo@4.0.2 --config svgo.config.mjs \
 *     -i src/assets/logo-institution.svg -o src/assets/logo-institution.min.svg
 *
 * Kept in the repo rather than run as a one-off so a future brand swap can
 * re-minify identically.
 *
 * What actually preserves the viewBox on svgo 4.0.2 is NOT removeViewBox.
 * In svgo 4, removeViewBox is no longer part of preset-default, so the
 * override below is inert there and svgo prints a warning that it is
 * "not part of preset-default". It is kept anyway as a svgo 3 carryover:
 * on svgo 3, removeViewBox is in preset-default and fires whenever the
 * root svg carries width/height, which ours does, so the override still
 * matters if this ever runs under svgo 3.
 *
 * The actual mechanism that keeps the viewBox numerically intact on
 * svgo 4.0.2 is the floatPrecision overrides below. A pixel-for-pixel
 * raster comparison against the pre-minification file caught real
 * regressions from the plugin defaults:
 *
 * - cleanupNumericValues and convertPathData each round their own share of
 *   numeric values (root attributes, and path "d" data, respectively) to a
 *   default floatPrecision of 3. That truncated the viewBox's
 *   "184.46667" to "184.467", a numeric change institution-logo.tsx and
 *   its test cannot tolerate, and shifted enough path coordinates to
 *   visibly deform letterforms. Both are raised so the original digits
 *   survive.
 * - convertTransform has the same default floatPrecision, which truncated
 *   the root transform's scale and translation; raised for the same
 *   reason.
 * - convertPathData's makeArcs and straightCurves are lossy by design:
 *   they replace curves with arcs or lines when "close enough" within a
 *   tolerance, which visibly deformed the mark's rounded letterforms.
 * - mergePaths combines separate same-style <path> elements into one,
 *   which is geometrically equivalent but rasterizes with different
 *   antialiasing at shared edges, producing a scatter of off-by-one-pixel
 *   differences at the render size the header uses.
 */
export default {
  multipass: true,
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          removeViewBox: false,
          cleanupNumericValues: { floatPrecision: 5 },
          convertPathData: {
            makeArcs: false,
            straightCurves: false,
            floatPrecision: 5,
          },
          convertTransform: { floatPrecision: 8, transformPrecision: 8 },
          mergePaths: false,
        },
      },
    },
  ],
};
