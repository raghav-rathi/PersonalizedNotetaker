const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;

function clampBoundsToWorkArea(bounds, workArea) {
    const width = Math.min(Math.max(MIN_WIDTH, Math.round(bounds.width)), workArea.width);
    const height = Math.min(Math.max(MIN_HEIGHT, Math.round(bounds.height)), workArea.height);
    return {
        x: Math.min(Math.max(Math.round(bounds.x), workArea.x), workArea.x + workArea.width - width),
        y: Math.min(Math.max(Math.round(bounds.y), workArea.y), workArea.y + workArea.height - height),
        width,
        height,
    };
}

/**
 * The bounds after dragging a resize handle by (dx, dy) from where the drag started. `edge` names the
 * sides that move, such as 'right', 'bottom' or 'bottom-left'. A left edge keeps the right side where it is.
 * @param {{x:number, y:number, width:number, height:number}} start
 * @param {string} edge
 * @param {number} dx
 * @param {number} dy
 */
function resizeBounds(start, edge, dx, dy) {
    const next = { ...start };
    if (edge.includes('right')) next.width = Math.max(MIN_WIDTH, start.width + dx);
    if (edge.includes('left')) {
        next.width = Math.max(MIN_WIDTH, start.width - dx);
        next.x = start.x + start.width - next.width;
    }
    if (edge.includes('bottom')) next.height = Math.max(MIN_HEIGHT, start.height + dy);
    return next;
}

module.exports = { clampBoundsToWorkArea, resizeBounds };
