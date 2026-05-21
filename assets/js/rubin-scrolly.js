/*
 * Rubin LSST scroll-pinned animation
 * -----------------------------------------------------------------------------
 * Scrolling through a tall outer wrapper drives a 0->1 progress value that
 * plays a multi-pass survey animation in a sticky scene:
 *
 *   * 6 sky patches in a 3 x 2 grid
 *   * 3 full passes across all 6 patches  ->  18 visits total
 *   * Each visit reveals one more layer of galaxies in that patch
 *   * The Rubin "camera footprint" rectangle hops from patch to patch
 *   * A scan beam follows the footprint from the telescope on Cerro Pachon
 *
 * No external libraries; pointer-events on the scrolly are preserved so the
 * user can still select text in the rest of the page. Block-comment style
 * everywhere so the Jekyll compress.html layout cannot kill anything.
 */

(function () {
    'use strict';

    var SCENE_W = 1200;
    var SCENE_H = 720;

    /* 6 patches arranged in a 3-cols x 2-rows grid */
    var PATCHES_PER_ROW = 3;
    var PATCH_COLS = 3;
    var PATCH_ROWS = 2;
    var PATCH_AREA = { x: 60, y: 50, w: 1080, h: 400 };
    var PATCH_W = PATCH_AREA.w / PATCH_COLS;
    var PATCH_H = PATCH_AREA.h / PATCH_ROWS;
    var N_PATCHES = PATCH_COLS * PATCH_ROWS;

    var N_PASSES = 3;
    var TOTAL_VISITS = N_PATCHES * N_PASSES;          /* 18 */

    var GALAXIES_PER_LAYER = 28;                       /* per patch per pass */

    /* Snake order so the camera moves smoothly: row 0 left->right, row 1 right->left */
    function patchOrder() {
        var order = [];
        for (var row = 0; row < PATCH_ROWS; row++) {
            for (var col = 0; col < PATCH_COLS; col++) {
                var c = (row % 2 === 0) ? col : (PATCH_COLS - 1 - col);
                order.push(row * PATCH_COLS + c);
            }
        }
        return order; /* length 6 */
    }
    var PATCH_ORDER = patchOrder();

    function patchBBox(patchIdx) {
        var row = Math.floor(patchIdx / PATCH_COLS);
        var col = patchIdx % PATCH_COLS;
        return {
            x: PATCH_AREA.x + col * PATCH_W,
            y: PATCH_AREA.y + row * PATCH_H,
            w: PATCH_W,
            h: PATCH_H
        };
    }

    /* Deterministic pseudo-random — same galaxies on every page load */
    function mulberry32(seed) {
        return function () {
            seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
            var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function svgEl(name, attrs) {
        var el = document.createElementNS('http://www.w3.org/2000/svg', name);
        if (attrs) for (var k in attrs) el.setAttribute(k, attrs[k]);
        return el;
    }

    /* ===================================================================== */
    /* Scene construction                                                    */
    /* ===================================================================== */

    function buildScene(scrolly) {
        var svg = scrolly.querySelector('.rubin-scene');
        if (!svg) return null;

        /* Galaxy layer (added first so it sits behind the footprint and telescope) */
        var galaxiesG = svgEl('g', { 'class': 'galaxies' });
        svg.insertBefore(galaxiesG, svg.querySelector('.foreground'));

        var rng = mulberry32(20260521);
        var byPatchAndPass = [];
        for (var p = 0; p < N_PATCHES; p++) {
            byPatchAndPass[p] = [];
            var bbox = patchBBox(p);
            for (var pass = 0; pass < N_PASSES; pass++) {
                var arr = [];
                for (var i = 0; i < GALAXIES_PER_LAYER; i++) {
                    /* Margin so galaxies don't sit on patch edges */
                    var pad = 14;
                    var gx = bbox.x + pad + rng() * (bbox.w - 2 * pad);
                    var gy = bbox.y + pad + rng() * (bbox.h - 2 * pad);
                    /* Bigger, brighter galaxies on earlier passes; tiny faint stars on later */
                    var r = 1.0 + rng() * (pass === 0 ? 1.8 : (pass === 1 ? 1.4 : 1.0));
                    var c = svgEl('circle', {
                        cx: gx.toFixed(1),
                        cy: gy.toFixed(1),
                        r: r.toFixed(2),
                        'class': 'galaxy pass-' + pass,
                        fill: pass === 0 ? '#7cf4ff' : (pass === 1 ? '#c7d2fe' : '#f8fbff')
                    });
                    galaxiesG.appendChild(c);
                    arr.push(c);
                }
                byPatchAndPass[p].push(arr);
            }
        }

        /* The Rubin camera footprint rectangle */
        var fpInitial = patchBBox(PATCH_ORDER[0]);
        var footprint = svgEl('rect', {
            x: fpInitial.x,
            y: fpInitial.y,
            width: fpInitial.w,
            height: fpInitial.h,
            'class': 'footprint'
        });
        svg.appendChild(footprint);

        /* Scan beam from telescope to current patch centre */
        var beam = svgEl('path', { 'class': 'scan-beam', d: '' });
        svg.appendChild(beam);

        return {
            svg: svg,
            galaxies: byPatchAndPass,
            footprint: footprint,
            beam: beam
        };
    }

    /* ===================================================================== */
    /* Progress -> scene state                                               */
    /* ===================================================================== */

    var TELESCOPE = { x: 600, y: 545 };  /* dome position in scene coords */

    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

    function applyProgress(state, progress, opts) {
        if (!state) return;
        progress = clamp(progress, 0, 1);
        var indicator = opts && opts.indicator;
        var label = opts && opts.label;

        /* Total expanded visits.  Visit index is fractional so the footprint
           transition is smooth between patches.                                  */
        var visitsF = progress * TOTAL_VISITS;
        var v = Math.floor(visitsF);
        if (v >= TOTAL_VISITS) v = TOTAL_VISITS - 1;
        var withinT = clamp(visitsF - v, 0, 1);

        var orderIdx = v % N_PATCHES;
        var currentPatch = PATCH_ORDER[orderIdx];
        var currentPass  = Math.floor(v / N_PATCHES);

        /* For each (patch, pass), reveal galaxies based on completion state.
           A pass is "fully revealed" for patch p if at least one visit
           v' >= 0..(v-1) with v' >= currentVisitFor(p, pass).                    */
        for (var p = 0; p < N_PATCHES; p++) {
            for (var pass = 0; pass < N_PASSES; pass++) {
                /* Has this (p, pass) been visited? Find the visit index that
                   corresponds to it.                                              */
                var orderIdxForP = PATCH_ORDER.indexOf(p);
                var visitForPP = pass * N_PATCHES + orderIdxForP;

                var op;
                if (visitForPP < v) {
                    op = 1;
                } else if (visitForPP === v) {
                    /* Currently being observed — fade in proportional to withinT */
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

        /* Move the footprint to the current patch. Slight transition during
           withinT to make the hop feel rhythmic rather than instant.             */
        var bb = patchBBox(currentPatch);
        /* Tiny "settle" — start a little larger and shrink to fit */
        var inflate = 6 * (1 - clamp(withinT * 3, 0, 1));
        var fx = bb.x - inflate;
        var fy = bb.y - inflate;
        var fw = bb.w + 2 * inflate;
        var fh = bb.h + 2 * inflate;
        state.footprint.setAttribute('x', fx.toFixed(1));
        state.footprint.setAttribute('y', fy.toFixed(1));
        state.footprint.setAttribute('width',  fw.toFixed(1));
        state.footprint.setAttribute('height', fh.toFixed(1));
        /* Pulsing accent intensity per visit start */
        var pulse = 1 - clamp(withinT * 2, 0, 1);
        state.footprint.style.filter = 'drop-shadow(0 0 ' + (8 + pulse * 14).toFixed(1) + 'px rgba(124,244,255,' + (0.4 + pulse * 0.4).toFixed(2) + '))';

        /* Scan beam from telescope to patch centre */
        var cx = bb.x + bb.w / 2;
        var cy = bb.y + bb.h / 2;
        var d = 'M' + TELESCOPE.x + ',' + TELESCOPE.y + ' L' + cx.toFixed(1) + ',' + cy.toFixed(1);
        state.beam.setAttribute('d', d);
        state.beam.style.opacity = (0.25 + 0.55 * (1 - withinT)).toFixed(2);

        /* Update the floating progress badge */
        if (indicator) {
            var pct = Math.round(progress * 100);
            indicator.style.width = pct + '%';
        }
        if (label) {
            label.textContent = 'Pass ' + (currentPass + 1) + ' / ' + N_PASSES
                              + '  *  Patch ' + (orderIdx + 1) + ' / ' + N_PATCHES;
        }
    }

    /* ===================================================================== */
    /* Wire up the scroll -> progress mapping                                */
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
            /* total scroll distance over which to play the animation */
            var total = scrolly.offsetHeight - vh;
            if (total <= 0) {
                applyProgress(state, 0, { indicator: indicator, label: label });
                return;
            }
            /* scrolled past the top of the scrolly */
            var scrolled = -rect.top;
            var progress = clamp(scrolled / total, 0, 1);
            applyProgress(state, progress, { indicator: indicator, label: label });
        }

        /* Initial state */
        applyProgress(state, 0, { indicator: indicator, label: label });

        var ticking = false;
        window.addEventListener('scroll', function () {
            if (ticking) return;
            window.requestAnimationFrame(function () { update(); ticking = false; });
            ticking = true;
        }, { passive: true });
        window.addEventListener('resize', update, { passive: true });

        /* If JS-disabled / mobile fallback: leave the scene at progress 1 so
           visitors at least see the final state of the LSST footprint. */
        scrolly.classList.add('is-ready');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
