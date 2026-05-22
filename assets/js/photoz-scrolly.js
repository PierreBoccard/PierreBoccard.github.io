/*
 * Photo-z line-of-sight shuffling animation
 * -----------------------------------------------------------------------------
 * Scroll-pinned scene that illustrates what a photometric redshift error
 * actually does to the observed 3D galaxy distribution:
 *
 *   scroll progress 0  ->  galaxies sit at their TRUE positions; you can
 *                          clearly see the cosmic-web filaments and the
 *                          voids between them
 *
 *   scroll progress 1  ->  every galaxy has been displaced ALONG THE LINE
 *                          OF SIGHT (the vertical axis of this 2D slice)
 *                          by a Gaussian random amount. Filaments smear out
 *                          along y, voids fill up with shuffled galaxies,
 *                          and the cosmic web becomes much harder to see.
 *
 * Galaxies are generated procedurally:
 *   - 28 Voronoi seeds in a 2D bounding box (these are the cluster nodes)
 *   - For every Voronoi edge that lies inside the box, scatter ~40 galaxies
 *     along it with a small transverse jitter (the filament thickness)
 *   - Each galaxy is assigned a fixed Gaussian noise draw N(0, 1); during
 *     animation the on-screen y is `trueY + progress * MAX_SHIFT * noise`
 *
 * A live label at the bottom announces the current photo-z scatter
 * sigma_z and the corresponding LOS smearing in Mpc/h.
 *
 * No external libs. Block comments throughout (the Jekyll compress.html
 * layout collapses single-line // comments).
 */

(function () {
    'use strict';

    var SVG_NS = 'http://www.w3.org/2000/svg';

    /* ===================================================================== */
    /* Geometry & parameters                                                 */
    /* ===================================================================== */

    var SCENE = { x: 0, y: 0, w: 1800, h: 900 };
    /* Sky area where galaxies live (margin for axes / labels) */
    var SKY = { x: 80, y: 70, w: 1640, h: 720 };

    var N_SEEDS = 28;
    var GALAXIES_PER_EDGE = 38;
    var BG_GALAXIES = 600;                /* faint scattered field galaxies */

    /* Maximum LOS displacement at full scroll progress. Roughly maps to
       sigma_z = 0.05 at z = 1 (~150 Mpc/h), expressed as a fraction of
       the SKY height. */
    var MAX_LOS_SHIFT_PX = 280;

    /* Physical sigma_z scale shown in the on-screen label. Goes from 0
       at the top of the scroll to SIGMA_Z_MAX at the bottom. */
    var SIGMA_Z_MAX = 0.05;

    /* Palette */
    var PASS_COLOURS = ['#7cf4ff', '#c7d2fe', '#f8fbff'];

    /* Deterministic RNG so the scene is identical on every page load */
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

    /* Box-Muller -> standard normal */
    function gaussian(rng) {
        var u1 = 1 - rng();
        var u2 = 1 - rng();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    /* ===================================================================== */
    /* Lloyd-relaxed Voronoi (simple, no scipy)                              */
    /* We just need the SEEDS and the DELAUNAY-edge set; we don't need to    */
    /* draw the filaments, only sample galaxies along them.                  */
    /* ===================================================================== */

    function generateSeeds(rng) {
        var seeds = [];
        var maxTries = N_SEEDS * 30;
        var minDist = Math.min(SKY.w, SKY.h) / Math.sqrt(N_SEEDS) * 0.75;
        for (var t = 0; t < maxTries && seeds.length < N_SEEDS; t++) {
            var x = SKY.x + rng() * SKY.w;
            var y = SKY.y + rng() * SKY.h;
            var ok = true;
            for (var i = 0; i < seeds.length; i++) {
                var dx = seeds[i].x - x;
                var dy = seeds[i].y - y;
                if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
            }
            if (ok) seeds.push({ x: x, y: y });
        }
        return seeds;
    }

    /* Naive Delaunay-ish edges: connect each seed to its 4 nearest neighbours.
       Good enough for a visual filament network. */
    function nearestEdges(seeds, k) {
        var edges = [];
        var seen = {};
        for (var i = 0; i < seeds.length; i++) {
            var ds = [];
            for (var j = 0; j < seeds.length; j++) if (j !== i) {
                var dx = seeds[i].x - seeds[j].x;
                var dy = seeds[i].y - seeds[j].y;
                ds.push({ j: j, d2: dx * dx + dy * dy });
            }
            ds.sort(function (a, b) { return a.d2 - b.d2; });
            for (var n = 0; n < k && n < ds.length; n++) {
                var a = Math.min(i, ds[n].j), b = Math.max(i, ds[n].j);
                var key = a + ':' + b;
                if (!seen[key]) {
                    seen[key] = true;
                    edges.push({ a: seeds[a], b: seeds[b] });
                }
            }
        }
        return edges;
    }

    /* ===================================================================== */
    /* Scene construction                                                    */
    /* ===================================================================== */

    function buildScene(scrolly) {
        var svg = scrolly.querySelector('.photoz-scene');
        if (!svg) return null;
        var rng = mulberry32(20260522);

        /* ----- Galaxies along Voronoi-like filaments ----- */
        var seeds = generateSeeds(rng);
        var edges = nearestEdges(seeds, 3);

        var galaxiesG = svgEl('g', { 'class': 'photoz-galaxies' });
        var galaxies = [];

        function addGalaxy(x, y, r, alpha) {
            /* Each galaxy gets a fixed standard-normal "noise" sample; the
               displayed y at scroll progress p is trueY + p * MAX_SHIFT * noise. */
            var noise = gaussian(rng);
            var color = PASS_COLOURS[Math.floor(rng() * PASS_COLOURS.length)];
            var c = svgEl('circle', {
                cx: x.toFixed(1), cy: y.toFixed(1),
                r: r.toFixed(2),
                fill: color,
                'class': 'photoz-galaxy'
            });
            c.style.opacity = alpha;
            galaxiesG.appendChild(c);
            galaxies.push({ el: c, trueX: x, trueY: y, noise: noise });
        }

        /* Galaxies along each filament edge */
        edges.forEach(function (e) {
            for (var n = 0; n < GALAXIES_PER_EDGE; n++) {
                var tt = rng();
                var x = e.a.x + tt * (e.b.x - e.a.x);
                var y = e.a.y + tt * (e.b.y - e.a.y);
                /* Small transverse jitter -> filament thickness */
                var perpX = -(e.b.y - e.a.y);
                var perpY =  (e.b.x - e.a.x);
                var L = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
                perpX /= L; perpY /= L;
                var jitter = gaussian(rng) * 6;
                x += perpX * jitter;
                y += perpY * jitter;
                if (x < SKY.x || x > SKY.x + SKY.w || y < SKY.y || y > SKY.y + SKY.h) continue;
                addGalaxy(x, y, 1.4 + rng() * 1.6, 0.45 + rng() * 0.45);
            }
        });

        /* Bright knots at the seeds (galaxy clusters) */
        seeds.forEach(function (s) {
            for (var n = 0; n < 18; n++) {
                var dx = gaussian(rng) * 12;
                var dy = gaussian(rng) * 12;
                addGalaxy(s.x + dx, s.y + dy, 2.0 + rng() * 1.8, 0.7 + rng() * 0.25);
            }
        });

        /* Sparse field galaxies everywhere (so voids aren't perfectly empty) */
        for (var bg = 0; bg < BG_GALAXIES; bg++) {
            var bx = SKY.x + rng() * SKY.w;
            var by = SKY.y + rng() * SKY.h;
            addGalaxy(bx, by, 0.9 + rng() * 0.9, 0.20 + rng() * 0.25);
        }

        svg.appendChild(galaxiesG);

        /* ----- LOS direction arrow on the right ----- */
        var arrowG = svgEl('g', { 'class': 'photoz-arrow' });
        var arrowX = SCENE.w - 35;
        var arrowY1 = SKY.y + 30;
        var arrowY2 = SKY.y + SKY.h - 30;
        arrowG.appendChild(svgEl('line', {
            x1: arrowX, y1: arrowY1, x2: arrowX, y2: arrowY2,
            'class': 'photoz-axis'
        }));
        /* arrow heads */
        arrowG.appendChild(svgEl('polygon', {
            points: arrowX + ',' + (arrowY1 - 4) + ' ' +
                    (arrowX - 6) + ',' + (arrowY1 + 6) + ' ' +
                    (arrowX + 6) + ',' + (arrowY1 + 6),
            'class': 'photoz-axis-head'
        }));
        arrowG.appendChild(svgEl('polygon', {
            points: arrowX + ',' + (arrowY2 + 4) + ' ' +
                    (arrowX - 6) + ',' + (arrowY2 - 6) + ' ' +
                    (arrowX + 6) + ',' + (arrowY2 - 6),
            'class': 'photoz-axis-head'
        }));
        var lbl = svgEl('text', {
            x: arrowX - 18, y: SKY.y + SKY.h / 2,
            'class': 'photoz-axis-label', 'text-anchor': 'middle',
            transform: 'rotate(-90 ' + (arrowX - 18) + ' ' + (SKY.y + SKY.h / 2) + ')'
        });
        lbl.textContent = 'LINE OF SIGHT  *  redshift';
        arrowG.appendChild(lbl);
        svg.appendChild(arrowG);

        return { svg: svg, galaxies: galaxies };
    }

    /* ===================================================================== */
    /* Progress -> scene                                                     */
    /* ===================================================================== */

    function applyProgress(state, progress, opts) {
        if (!state) return;
        progress = clamp(progress, 0, 1);

        /* Smoother feel: ease-in-out the displacement so the start is calm
           and the late part still has movement to give */
        var p = progress * progress * (3 - 2 * progress);

        for (var i = 0; i < state.galaxies.length; i++) {
            var g = state.galaxies[i];
            var dy = p * MAX_LOS_SHIFT_PX * g.noise;
            /* Clamp to stay within the sky box (otherwise outliers wander off) */
            var newY = g.trueY + dy;
            if (newY < SKY.y) newY = SKY.y;
            else if (newY > SKY.y + SKY.h) newY = SKY.y + SKY.h;
            g.el.setAttribute('cy', newY.toFixed(1));
        }

        if (opts) {
            if (opts.hudBar) opts.hudBar.style.width = (progress * 100).toFixed(1) + '%';
            if (opts.hudSigma) {
                var sig = (SIGMA_Z_MAX * progress).toFixed(3);
                opts.hudSigma.textContent = 'σₙ = ' + sig;
            }
            if (opts.hudSmear) {
                /* Rough conversion: sigma_z * c / H(z) -> Mpc/h.
                   For z ~ 1 in flat LCDM, c / H(z) is roughly ~3000 / E(z) /
                   h Mpc. We pick 3100 Mpc/h as a representative number and
                   multiply by sigma_z * (1 + z). */
                var sigVal = SIGMA_Z_MAX * progress;
                var smearMpc = Math.round(sigVal * 3100);
                opts.hudSmear.textContent = '≈ ' + smearMpc + ' Mpc/h smear';
            }
        }
    }

    /* ===================================================================== */
    /* Init                                                                  */
    /* ===================================================================== */

    function init() {
        var scrolly = document.getElementById('photozScrolly');
        if (!scrolly) return;
        var state = buildScene(scrolly);
        var hudBar    = scrolly.querySelector('.scrolly-progress-bar');
        var hudSigma  = scrolly.querySelector('.scrolly-progress-label .sigma');
        var hudSmear  = scrolly.querySelector('.scrolly-progress-label .smear');

        function update() {
            var rect = scrolly.getBoundingClientRect();
            var vh = window.innerHeight;
            var total = scrolly.offsetHeight - vh;
            if (total <= 0) {
                applyProgress(state, 0, { hudBar: hudBar, hudSigma: hudSigma, hudSmear: hudSmear });
                return;
            }
            var scrolled = -rect.top;
            var p = clamp(scrolled / total, 0, 1);
            applyProgress(state, p, { hudBar: hudBar, hudSigma: hudSigma, hudSmear: hudSmear });
        }

        applyProgress(state, 0, { hudBar: hudBar, hudSigma: hudSigma, hudSmear: hudSmear });

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
