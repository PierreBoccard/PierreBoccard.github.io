/*
 * Rubin LSST scroll-pinned animation (v3)
 * -----------------------------------------------------------------------------
 * Scrolling through a tall outer wrapper drives a 0->1 progress value that
 * plays a multi-pass survey animation in a sticky scene:
 *
 *   * 6 sky patches in a 3 x 2 grid, upper-left of the scene
 *   * 5 full passes across all 6 patches  ->  30 visits total
 *   * Each visit reveals one more layer of galaxies in that patch
 *   * An OCTAGONAL camera footprint (chamfered square) hops between patches,
 *     with a CCD-grid hatch inside (lines clipped to the octagon)
 *   * A triangular LIGHT CONE from the telescope apex (lower-right) to the
 *     current patch, filled with a linear gradient
 *
 * v3 design notes
 *   * The footprint is rebuilt in ABSOLUTE user-space coords on every frame.
 *     CSS transforms on SVG <g> were unreliable across browsers; computing
 *     points directly is bulletproof.
 *   * The CCD-grid lines are clipped by a <clipPath> whose polygon is
 *     updated to the current octagon on every frame, so the hatch sits
 *     cleanly inside the chamfered shape.
 *   * The lightcone gradient stops are re-anchored along the cone axis on
 *     every frame so bright -> faint always points telescope -> patch.
 *
 * Block-comment style throughout to survive the Jekyll compress.html layout.
 */

(function () {
    'use strict';

    var SVG_NS = 'http://www.w3.org/2000/svg';

    /* ===================================================================== */
    /* Geometry                                                              */
    /* ===================================================================== */

    /* Smaller sky region, pushed upper-left, so the cone has room to be long
       and the sky reads as "further away" from the telescope. */
    var SKY = { x: 60, y: 80, w: 720, h: 260 };
    var PATCH_COLS = 5;
    var PATCH_ROWS = 2;
    var PATCH_W = SKY.w / PATCH_COLS;
    var PATCH_H = SKY.h / PATCH_ROWS;
    var N_PATCHES = PATCH_COLS * PATCH_ROWS;     /* 10 */
    var N_PASSES = 5;
    var TOTAL_VISITS = N_PATCHES * N_PASSES;     /* 50 */
    var GALAXIES_PER_LAYER = 14;                  /* per patch per pass */

    /* Telescope apex (the LIGHT cone is anchored here) */
    var TELESCOPE = { x: 1000, y: 540 };

    /* Per-pass galaxy colour, 5 entries */
    var PASS_COLOURS = ['#7cf4ff', '#a96bff', '#41d0a4', '#ff7adf', '#f8fbff'];

    /* Chamfer fraction for the octagon (0..0.5) */
    var CHAMFER_FRAC = 0.28;

    /* Number of grid lines per axis inside the footprint */
    var GRID_STEPS = 4;

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

    /* Octagon vertices in absolute coords for a patch. inflate slightly
       oversizes the shape and is animated down to 0 during withinT to give
       the "settle" pulse on each visit. */
    function octagonPoints(bb, inflate) {
        var hw = (bb.w / 2) * (1 + inflate);
        var hh = (bb.h / 2) * (1 + inflate);
        var ch = CHAMFER_FRAC * Math.min(hw, hh);
        var cx = bb.cx, cy = bb.cy;
        return [
            [cx - hw + ch, cy - hh],
            [cx + hw - ch, cy - hh],
            [cx + hw,      cy - hh + ch],
            [cx + hw,      cy + hh - ch],
            [cx + hw - ch, cy + hh],
            [cx - hw + ch, cy + hh],
            [cx - hw,      cy + hh - ch],
            [cx - hw,      cy - hh + ch]
        ];
    }

    function pointsToStr(pts) {
        var out = '';
        for (var i = 0; i < pts.length; i++) {
            if (i > 0) out += ' ';
            out += pts[i][0].toFixed(2) + ',' + pts[i][1].toFixed(2);
        }
        return out;
    }

    /* ===================================================================== */
    /* Utilities                                                             */
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

        /* ---- Static patch grid -- 10 faint dashed outlines so the user
                can literally count "10 patches" on the sky --------------- */
        var patchGridG = svgEl('g', { 'class': 'patch-grid' });
        for (var pi = 0; pi < N_PATCHES; pi++) {
            var pbb = patchBBox(pi);
            patchGridG.appendChild(svgEl('rect', {
                x: (pbb.x + 1).toFixed(1),
                y: (pbb.y + 1).toFixed(1),
                width:  (pbb.w - 2).toFixed(1),
                height: (pbb.h - 2).toFixed(1),
                rx: 3,
                ry: 3
            }));
        }
        svg.insertBefore(patchGridG, foreground);

        /* ---- Light cone (drawn FIRST among dynamic layers) ------------ */
        var cone = svgEl('path', {
            'class': 'lightcone',
            d: 'M0,0 L0,0 L0,0 Z',
            fill: 'url(#lightConeGrad)'
        });
        svg.insertBefore(cone, foreground);

        /* ---- Galaxy layer --------------------------------------------- */
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
                    var pad = 10;
                    var gx = bb.x + pad + rng() * (bb.w - 2 * pad);
                    var gy = bb.y + pad + rng() * (bb.h - 2 * pad);
                    /* Earlier passes have larger, brighter galaxies */
                    var r = 1.0 + rng() * (pass <= 1 ? 1.5 : (pass <= 2 ? 1.1 : 0.8));
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

        /* ---- Octagonal footprint with CCD-grid hatch ------------------ */
        var fp = svgEl('g', { 'class': 'footprint' });

        /* Background fill polygon (octagon shape) */
        var fpShape = svgEl('polygon', { 'class': 'fp-shape', points: '0,0 0,0 0,0' });
        fp.appendChild(fpShape);

        /* CCD grid lines, clipped to the octagon by the shared clipPath */
        var grid = svgEl('g', { 'class': 'fp-grid', 'clip-path': 'url(#fpClipPath)' });
        var gridLines = [];
        for (var k = 0; k < 2 * GRID_STEPS; k++) {
            var line = svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 0 });
            grid.appendChild(line);
            gridLines.push(line);
        }
        fp.appendChild(grid);

        /* Outline on top so the chamfered corners read cleanly */
        var fpOutline = svgEl('polygon', { 'class': 'fp-outline', points: '0,0 0,0 0,0' });
        fp.appendChild(fpOutline);

        svg.insertBefore(fp, foreground);

        var clipPoly = svg.querySelector('#fpClipPoly');
        var gradient = svg.querySelector('#lightConeGrad');

        return {
            svg: svg,
            galaxies: byPatchAndPass,
            fp: fp,
            fpShape: fpShape,
            fpOutline: fpOutline,
            gridLines: gridLines,
            clipPoly: clipPoly,
            cone: cone,
            gradient: gradient
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

        /* ---- Galaxy reveal ---------------------------------------- */
        for (var p = 0; p < N_PATCHES; p++) {
            for (var pass = 0; pass < N_PASSES; pass++) {
                var orderIdxForP = PATCH_ORDER.indexOf(p);
                var visitForPP = pass * N_PATCHES + orderIdxForP;
                var op;
                if (visitForPP < v) op = 1;
                else if (visitForPP === v) op = clamp(withinT * 1.25, 0, 1);
                else op = 0;
                var layer = state.galaxies[p][pass];
                for (var i = 0; i < layer.length; i++) {
                    layer[i].style.opacity = op;
                }
            }
        }

        /* ---- Footprint position (absolute coords) ---------------- */
        var bb = patchBBox(currentPatch);
        var settle = 1 - clamp(withinT * 3, 0, 1);    /* 1 at start, 0 after a third */
        var inflate = 0.08 * settle;
        var poly = octagonPoints(bb, inflate);
        var polyStr = pointsToStr(poly);
        state.fpShape.setAttribute('points', polyStr);
        state.fpOutline.setAttribute('points', polyStr);
        if (state.clipPoly) state.clipPoly.setAttribute('points', polyStr);

        /* Grid lines: GRID_STEPS horizontal + GRID_STEPS vertical, in absolute
           coords spanning the inflated rectangle.  The clipPath crops them to
           the octagon. */
        var hw = (bb.w / 2) * (1 + inflate);
        var hh = (bb.h / 2) * (1 + inflate);
        var cx = bb.cx, cy = bb.cy;
        for (var s = 0; s < GRID_STEPS; s++) {
            var t = -1 + (2 * (s + 1)) / (GRID_STEPS + 1);
            /* Horizontal line */
            var lh = state.gridLines[2 * s];
            lh.setAttribute('x1', (cx - hw).toFixed(2));
            lh.setAttribute('y1', (cy + t * hh).toFixed(2));
            lh.setAttribute('x2', (cx + hw).toFixed(2));
            lh.setAttribute('y2', (cy + t * hh).toFixed(2));
            /* Vertical line */
            var lv = state.gridLines[2 * s + 1];
            lv.setAttribute('x1', (cx + t * hw).toFixed(2));
            lv.setAttribute('y1', (cy - hh).toFixed(2));
            lv.setAttribute('x2', (cx + t * hw).toFixed(2));
            lv.setAttribute('y2', (cy + hh).toFixed(2));
        }

        /* Pulsing glow per visit */
        var pulse = 1 - clamp(withinT * 2, 0, 1);
        state.fp.style.filter =
            'drop-shadow(0 0 ' + (8 + pulse * 16).toFixed(1) +
            'px rgba(124,244,255,' + (0.4 + pulse * 0.45).toFixed(2) + '))';

        /* ---- Light cone (apex at telescope, base across the patch) ---- */
        var dx = cx - TELESCOPE.x;
        var dy = cy - TELESCOPE.y;
        var L  = Math.sqrt(dx * dx + dy * dy) || 1;
        var nx = dx / L, ny = dy / L;
        var px = -ny,    py = nx;     /* perpendicular unit */
        /* Base half-width:  about the patch's larger half-extent perpendicular
           to the cone axis.  Use the major axis projection. */
        var baseHalf = Math.max(bb.w, bb.h) * 0.55;
        var baseAx = cx + px * baseHalf;
        var baseAy = cy + py * baseHalf;
        var baseBx = cx - px * baseHalf;
        var baseBy = cy - py * baseHalf;
        /* Apex offset so the cone doesn't pierce the dome */
        var apexX = TELESCOPE.x + nx * 30;
        var apexY = TELESCOPE.y + ny * 30;
        var dPath = 'M' + apexX.toFixed(1) + ',' + apexY.toFixed(1) +
                    ' L' + baseAx.toFixed(1) + ',' + baseAy.toFixed(1) +
                    ' L' + baseBx.toFixed(1) + ',' + baseBy.toFixed(1) + ' Z';
        state.cone.setAttribute('d', dPath);
        if (state.gradient) {
            state.gradient.setAttribute('x1', apexX.toFixed(1));
            state.gradient.setAttribute('y1', apexY.toFixed(1));
            state.gradient.setAttribute('x2', cx.toFixed(1));
            state.gradient.setAttribute('y2', cy.toFixed(1));
        }
        state.cone.style.opacity = (0.55 + 0.35 * (1 - withinT)).toFixed(2);

        /* ---- HUD -------------------------------------------------- */
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
