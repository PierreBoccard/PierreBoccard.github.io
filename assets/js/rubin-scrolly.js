/*
 * Rubin LSST scroll-pinned animation (v2)
 * -----------------------------------------------------------------------------
 * Scrolling through a tall outer wrapper drives a 0->1 progress value that
 * plays a multi-pass survey animation in a sticky scene:
 *
 *   * 6 sky patches in a 3 x 2 grid, upper-left of the scene
 *   * 5 full passes across all 6 patches  ->  30 visits total
 *   * Each visit reveals one more layer of galaxies in that patch
 *   * An OCTAGONAL camera footprint (chamfered square) hops between patches
 *     with a CCD-grid hatch pattern inside
 *   * A triangular LIGHT CONE drawn from the telescope apex (lower-right)
 *     to the current patch, filled with a linear gradient
 *
 * The scene is positioned with perspective: sky upper-left, telescope
 * lower-right, so the cone is naturally a long diagonal beam.
 *
 * No external libraries; block-comment style everywhere so the Jekyll
 * compress.html layout cannot kill anything.
 */

(function () {
    'use strict';

    var SVG_NS = 'http://www.w3.org/2000/svg';

    /* ===================================================================== */
    /* Geometry                                                              */
    /* ===================================================================== */

    /* Sky area: upper-left of the 1200 x 720 viewBox */
    var SKY = { x: 50, y: 70, w: 880, h: 360 };
    var PATCH_COLS = 3;
    var PATCH_ROWS = 2;
    var PATCH_W = SKY.w / PATCH_COLS;
    var PATCH_H = SKY.h / PATCH_ROWS;
    var N_PATCHES = PATCH_COLS * PATCH_ROWS;
    var N_PASSES = 5;
    var TOTAL_VISITS = N_PATCHES * N_PASSES;     /* 30 */
    var GALAXIES_PER_LAYER = 22;                  /* per patch per pass */

    /* Telescope apex (where the light cone is anchored) - lower right */
    var TELESCOPE = { x: 1020, y: 480 };

    /* Per-pass galaxy colour, 5 entries */
    var PASS_COLOURS = ['#7cf4ff', '#a96bff', '#41d0a4', '#ff7adf', '#f8fbff'];

    /* Snake order so the camera moves continuously between rows */
    function patchOrder() {
        var order = [];
        for (var row = 0; row < PATCH_ROWS; row++) {
            for (var col = 0; col < PATCH_COLS; col++) {
                var c = (row % 2 === 0) ? col : (PATCH_COLS - 1 - col);
                order.push(row * PATCH_COLS + c);
            }
        }
        return order;
    }
    var PATCH_ORDER = patchOrder();

    function patchBBox(patchIdx) {
        var row = Math.floor(patchIdx / PATCH_COLS);
        var col = patchIdx % PATCH_COLS;
        return {
            x: SKY.x + col * PATCH_W,
            y: SKY.y + row * PATCH_H,
            w: PATCH_W,
            h: PATCH_H,
            cx: SKY.x + col * PATCH_W + PATCH_W / 2,
            cy: SKY.y + row * PATCH_H + PATCH_H / 2
        };
    }

    /* ===================================================================== */
    /* Octagonal footprint                                                   */
    /* ===================================================================== */

    /* Unit octagon points (a square with chamfered corners, in [-1, 1] coords) */
    var CHAMFER = 0.30;
    var OCTAGON_POINTS = [
        [-1 + CHAMFER, -1], [ 1 - CHAMFER, -1],
        [ 1, -1 + CHAMFER], [ 1,  1 - CHAMFER],
        [ 1 - CHAMFER,  1], [-1 + CHAMFER,  1],
        [-1,  1 - CHAMFER], [-1, -1 + CHAMFER]
    ];
    function octagonPointsAttr() {
        return OCTAGON_POINTS.map(function (p) {
            return p[0].toFixed(4) + ',' + p[1].toFixed(4);
        }).join(' ');
    }

    /* ===================================================================== */
    /* Utility                                                               */
    /* ===================================================================== */

    function mulberry32(seed) {
        return function () {
            seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
            var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function svgEl(name, attrs) {
        var el = document.createElementNS(SVG_NS, name);
        if (attrs) for (var k in attrs) el.setAttribute(k, attrs[k]);
        return el;
    }
    function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

    /* ===================================================================== */
    /* Scene construction                                                    */
    /* ===================================================================== */

    function buildScene(scrolly) {
        var svg = scrolly.querySelector('.rubin-scene');
        if (!svg) return null;
        var foreground = svg.querySelector('.foreground');

        /* ---- Light cone path (drawn first so it sits behind galaxies) --- */
        var cone = svgEl('path', { 'class': 'lightcone', d: '', fill: 'url(#lightConeGrad)' });
        svg.insertBefore(cone, foreground);

        /* ---- Galaxy layer ---------------------------------------------- */
        var galaxiesG = svgEl('g', { 'class': 'galaxies' });
        svg.insertBefore(galaxiesG, foreground);

        var rng = mulberry32(20260521);
        var byPatchAndPass = [];
        for (var p = 0; p < N_PATCHES; p++) {
            byPatchAndPass[p] = [];
            var bb = patchBBox(p);
            for (var pass = 0; pass < N_PASSES; pass++) {
                var arr = [];
                for (var i = 0; i < GALAXIES_PER_LAYER; i++) {
                    var pad = 12;
                    var gx = bb.x + pad + rng() * (bb.w - 2 * pad);
                    var gy = bb.y + pad + rng() * (bb.h - 2 * pad);
                    /* Earlier passes have larger, brighter galaxies */
                    var r = 1.1 + rng() * (pass <= 1 ? 1.7 : (pass <= 2 ? 1.3 : 0.9));
                    var c = svgEl('circle', {
                        cx: gx.toFixed(1),
                        cy: gy.toFixed(1),
                        r: r.toFixed(2),
                        'class': 'galaxy pass-' + pass,
                        fill: PASS_COLOURS[pass]
                    });
                    galaxiesG.appendChild(c);
                    arr.push(c);
                }
                byPatchAndPass[p].push(arr);
            }
        }

        /* ---- Octagonal footprint with CCD-grid hatch ------------------- */
        var fp = svgEl('g', { 'class': 'footprint' });
        var pts = octagonPointsAttr();

        /* Background fill */
        fp.appendChild(svgEl('polygon', {
            'class': 'fp-shape',
            points: pts,
            'vector-effect': 'non-scaling-stroke'
        }));

        /* CCD grid lines, in unit coords, vector-effect to keep stroke crisp.
           Lines extend across the [-1, 1] box; the chamfered corners may show
           tiny line stubs which look like CCD-frame tick marks (intentional). */
        var grid = svgEl('g', { 'class': 'fp-grid' });
        var gridSteps = 4;  /* 4 lines per direction -> 5x5 cell grid */
        for (var k = 1; k <= gridSteps; k++) {
            var v = -1 + (2 * k) / (gridSteps + 1);
            grid.appendChild(svgEl('line', {
                x1: -1, y1: v.toFixed(4), x2: 1, y2: v.toFixed(4),
                'vector-effect': 'non-scaling-stroke'
            }));
            grid.appendChild(svgEl('line', {
                x1: v.toFixed(4), y1: -1, x2: v.toFixed(4), y2: 1,
                'vector-effect': 'non-scaling-stroke'
            }));
        }
        fp.appendChild(grid);

        /* Outline on top so chamfered corners read cleanly */
        fp.appendChild(svgEl('polygon', {
            'class': 'fp-outline',
            points: pts,
            'vector-effect': 'non-scaling-stroke'
        }));

        svg.insertBefore(fp, foreground);

        return {
            svg: svg,
            galaxies: byPatchAndPass,
            footprint: fp,
            cone: cone
        };
    }

    /* ===================================================================== */
    /* Progress -> scene state                                               */
    /* ===================================================================== */

    function applyProgress(state, progress, opts) {
        if (!state) return;
        progress = clamp(progress, 0, 1);
        var indicator = opts && opts.indicator;
        var label = opts && opts.label;

        var visitsF = progress * TOTAL_VISITS;
        var v = Math.floor(visitsF);
        if (v >= TOTAL_VISITS) v = TOTAL_VISITS - 1;
        var withinT = clamp(visitsF - v, 0, 1);

        var orderIdx = v % N_PATCHES;
        var currentPatch = PATCH_ORDER[orderIdx];
        var currentPass  = Math.floor(v / N_PATCHES);

        /* ---- Galaxy reveal per (patch, pass) --------------------------- */
        for (var p = 0; p < N_PATCHES; p++) {
            for (var pass = 0; pass < N_PASSES; pass++) {
                var orderIdxForP = PATCH_ORDER.indexOf(p);
                var visitForPP = pass * N_PATCHES + orderIdxForP;

                var op;
                if (visitForPP < v) {
                    op = 1;
                } else if (visitForPP === v) {
                    op = clamp(withinT * 1.25, 0, 1);
                } else {
                    op = 0;
                }
                var layer = state.galaxies[p][pass];
                for (var i = 0; i < layer.length; i++) {
                    layer[i].style.opacity = op;
                }
            }
        }

        /* ---- Footprint position + scale -------------------------------- */
        var bb = patchBBox(currentPatch);
        /* Settle effect: start a bit oversized, shrink during withinT */
        var settle = 1 - clamp(withinT * 3, 0, 1);
        var inflate = 0.08 * settle;            /* 8% oversize at start */
        var sx = (bb.w / 2) * (1 + inflate);
        var sy = (bb.h / 2) * (1 + inflate);
        var cx = bb.cx;
        var cy = bb.cy;
        state.footprint.style.transform =
            'translate(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px)' +
            ' scale(' + sx.toFixed(2) + ',' + sy.toFixed(2) + ')';
        /* Pulsing glow per visit */
        var pulse = 1 - clamp(withinT * 2, 0, 1);
        state.footprint.style.filter =
            'drop-shadow(0 0 ' + (8 + pulse * 16).toFixed(1) +
            'px rgba(124,244,255,' + (0.4 + pulse * 0.45).toFixed(2) + '))';

        /* ---- Light cone polygon ---------------------------------------- */
        /* Triangle from telescope apex to a wide base across the patch. */
        var dx = cx - TELESCOPE.x;
        var dy = cy - TELESCOPE.y;
        var L  = Math.sqrt(dx * dx + dy * dy) || 1;
        var nx = dx / L;
        var ny = dy / L;
        /* Perpendicular unit vector (right-hand rule) */
        var px = -ny;
        var py =  nx;
        /* Base of the cone: as wide as the patch's diagonal projection */
        var baseHalf = 0.5 * Math.sqrt(bb.w * bb.w + bb.h * bb.h) * 0.55;
        var baseAx = cx + px * baseHalf;
        var baseAy = cy + py * baseHalf;
        var baseBx = cx - px * baseHalf;
        var baseBy = cy - py * baseHalf;
        /* Apex offset so the cone doesn't visually pierce the telescope body */
        var apexX = TELESCOPE.x + nx * 28;
        var apexY = TELESCOPE.y + ny * 28;
        var d = 'M' + apexX.toFixed(1) + ',' + apexY.toFixed(1) +
                ' L' + baseAx.toFixed(1) + ',' + baseAy.toFixed(1) +
                ' L' + baseBx.toFixed(1) + ',' + baseBy.toFixed(1) + ' Z';
        state.cone.setAttribute('d', d);
        /* Align the gradient stops along the cone axis so bright -> faint goes
           from telescope toward patch */
        var grad = state.svg.querySelector('#lightConeGrad');
        if (grad) {
            grad.setAttribute('x1', apexX.toFixed(1));
            grad.setAttribute('y1', apexY.toFixed(1));
            grad.setAttribute('x2', cx.toFixed(1));
            grad.setAttribute('y2', cy.toFixed(1));
        }
        state.cone.style.opacity = (0.55 + 0.35 * (1 - withinT)).toFixed(2);

        /* ---- HUD ------------------------------------------------------- */
        if (indicator) indicator.style.width = (progress * 100).toFixed(1) + '%';
        if (label) {
            label.textContent = 'Pass ' + (currentPass + 1) + ' / ' + N_PASSES
                              + '  *  Patch ' + (orderIdx + 1) + ' / ' + N_PATCHES;
        }
    }

    /* ===================================================================== */
    /* Wire scroll -> progress                                               */
    /* ===================================================================== */

    function init() {
        var scrolly = document.getElementById('rubinScrolly');
        if (!scrolly) return;
        var state = buildScene(scrolly);
        var indicator = scrolly.querySelector('.scrolly-progress-bar');
        var label     = scrolly.querySelector('.scrolly-progress-label');

        function update() {
            var rect = scrolly.getBoundingClientRect();
            var vh = window.innerHeight;
            var total = scrolly.offsetHeight - vh;
            if (total <= 0) {
                applyProgress(state, 0, { indicator: indicator, label: label });
                return;
            }
            var scrolled = -rect.top;
            var progress = clamp(scrolled / total, 0, 1);
            applyProgress(state, progress, { indicator: indicator, label: label });
        }

        applyProgress(state, 0, { indicator: indicator, label: label });

        var ticking = false;
        window.addEventListener('scroll', function () {
            if (ticking) return;
            window.requestAnimationFrame(function () { update(); ticking = false; });
            ticking = true;
        }, { passive: true });
        window.addEventListener('resize', update, { passive: true });

        scrolly.classList.add('is-ready');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
