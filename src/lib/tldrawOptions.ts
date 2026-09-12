/**
 * Shared tldraw editor options.
 *
 * tldraw refuses to create shapes once a page holds `maxShapesPerPage`
 * (default 4000) and fires a "max-shapes" event instead. A dense
 * handwriting lesson reaches 4000 well inside one session — every pen
 * stroke is a shape — and the failure mode is silent to the tutor: the pen
 * simply stops drawing. This lifts the ceiling so it isn't reachable in a
 * lesson.
 *
 * It is a large number rather than Infinity ON PURPOSE, for two reasons.
 *
 * 1. `maxShapesPerPage` is also a z-index stride. Editor's
 *    getUnorderedRenderingShapes() seeds `nextIndex = maxShapesPerPage * 2`
 *    and `nextBackgroundIndex = maxShapesPerPage`, adding another
 *    `maxShapesPerPage` per background-providing nesting level. Those
 *    indices are emitted as CSS z-index values, which browsers hold in a
 *    32-bit signed int (max 2,147,483,647). Infinity or
 *    Number.MAX_SAFE_INTEGER overflows that and breaks layering. At
 *    1,000,000 the stride starts at 2,000,000 — three orders of magnitude
 *    inside the CSS cap, with room for far more nesting than this app can
 *    produce (the frame tool, the main source of nested backgrounds, is
 *    disabled in WhiteboardCanvas's tools() override).
 *
 * 2. That same stride assumes a page holds no more shapes than
 *    `maxShapesPerPage`. If a page ever exceeded it, the background index
 *    range would run into the foreground index range and shapes would
 *    layer incorrectly. So the value must stay comfortably ABOVE any real
 *    page's shape count — it is a ceiling, not a hint.
 *
 * Use this for EVERY <Tldraw> instance, not just the live canvas. The
 * playback viewer renders recorded snapshots from live rooms, so it has to
 * share the stride or a recording of a >4000-shape lesson would render
 * with the layering bug described in (2).
 *
 * This raises a ceiling; it does not make huge pages fast. Rendering cost
 * and the sync worker's snapshot size both still grow with shape count. If
 * a room ever does get slow, look at shape count per page first.
 */
export const TLDRAW_OPTIONS = { maxShapesPerPage: 1_000_000 };
