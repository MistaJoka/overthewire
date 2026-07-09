/* FX layer (Task 10) — CRT overlay, generative node-mesh background, capture
 * cascade. Purely cosmetic; every entry point is safe to call even if init()
 * never ran, threw, or the user has FX disabled. On ANY failure the whole
 * module degrades to no-op stubs so app.js / term.js never break.
 *
 * Public API (window.FX):
 *   init()              — read persisted state, wire canvas + CRT class.
 *   setEnabled(bool)     — explicit user toggle; persists 'on'/'off'.
 *   isEnabled()          — current resolved enabled state.
 *   onThemeChange()      — re-resolve when persisted state is 'auto'.
 *   captureCascade(to)   — green sweep through sidebar rows + node pulse.
 *   keystroke(x,y)       — optional glow particle at viewport coords.
 *
 * Persisted key: bandit_fx_v1 = 'auto' | 'on' | 'off' (default 'auto').
 * 'auto' resolves to on-in-dark-theme / off-in-light-theme.
 */
(function () {
  const NOOP = {
    init() {},
    setEnabled() {},
    isEnabled() { return false; },
    onThemeChange() {},
    captureCascade() {},
    keystroke() {},
  };
  // Safe default until (if) the real impl finishes constructing below.
  window.FX = NOOP;

  try {
    const KEY = 'bandit_fx_v1';
    const fxStore = {
      get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* soft-fail */ } },
    };

    let state = 'auto';        // 'auto' | 'on' | 'off'
    let reducedMotion = false;
    let enabled = false;
    let canvas = null, ctx = null;
    let W = 0, H = 0, dpr = 1;
    let nodes = [];
    let particles = [];        // keystroke glow: {x,y,start}
    let rafId = null;
    let lastFrame = 0;
    let resizeBound = false;

    function isDarkTheme() {
      return document.documentElement.getAttribute('data-theme') !== 'light';
    }
    function resolveEnabled() {
      if (reducedMotion) return false;
      if (state === 'on') return true;
      if (state === 'off') return false;
      return isDarkTheme();
    }
    function cssVar(name, fallback) {
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
      } catch (e) { return fallback; }
    }
    function hexAlpha(hex, alpha) {
      const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
      const a = Math.max(0, Math.min(1, alpha));
      if (!m) return hex;
      const n = parseInt(m[1], 16);
      const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }

    // app.js/data.js declare `done`/`LEVELS` with let/const at classic-script
    // top level — those do NOT become window properties, but they DO live in
    // the shared global lexical scope, so a bare reference (guarded, since
    // this file loads before app.js runs) is the correct way to reach them.
    function currentLevels() {
      try { if (typeof LEVELS !== 'undefined' && LEVELS && LEVELS.length) return LEVELS; } catch (e) {}
      return null;
    }
    function currentDone() {
      try { if (typeof done !== 'undefined' && done instanceof Set) return done; } catch (e) {}
      return new Set();
    }

    function buildNodes() {
      const levelsArr = currentLevels();
      const n = levelsArr ? levelsArr.length : 33;
      const golden = Math.PI * (3 - Math.sqrt(5)); // golden-angle spiral
      const next = [];
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const r = Math.sqrt(t);
        const theta = i * golden;
        const jx = (Math.random() - 0.5) * 0.06;
        const jy = (Math.random() - 0.5) * 0.06;
        const cx = 0.5 + (r * 0.46 + jx) * Math.cos(theta);
        const cy = 0.5 + (r * 0.46 + jy) * Math.sin(theta);
        next.push({
          x: Math.max(0, Math.min(1, cx)) * W,
          y: Math.max(0, Math.min(1, cy)) * H,
          vx: (Math.random() - 0.5) * 0.14,
          vy: (Math.random() - 0.5) * 0.14,
          to: levelsArr ? levelsArr[i].to : i + 1,
          pulseUntil: 0,
        });
      }
      nodes = next;
    }

    function fit() {
      if (!canvas) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildNodes();
    }

    function draw(ts) {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      const doneSet = currentDone();
      const teal = cssVar('--teal', '#6bb3a0');
      const doneColor = cssVar('--done', '#7fc77f');
      const amberDim = cssVar('--amber-dim', '#b87d28');
      const amber = cssVar('--amber', '#f0a830');

      for (const nd of nodes) {
        nd.x += nd.vx; nd.y += nd.vy;
        if (nd.x < 0 || nd.x > W) { nd.vx *= -1; nd.x = Math.max(0, Math.min(W, nd.x)); }
        if (nd.y < 0 || nd.y > H) { nd.vy *= -1; nd.y = Math.max(0, Math.min(H, nd.y)); }
      }

      const THRESH = Math.max(90, Math.min(W, H) * 0.14);
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < THRESH) {
            const bothDone = doneSet.has(a.to) && doneSet.has(b.to);
            const alpha = (1 - d / THRESH) * (bothDone ? 0.32 : 0.18);
            ctx.strokeStyle = hexAlpha(bothDone ? doneColor : teal, alpha);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const nd of nodes) {
        const isNodeDone = doneSet.has(nd.to);
        const r = isNodeDone ? 3 : 2;
        if (nd.pulseUntil && ts < nd.pulseUntil) {
          const p = 1 - (nd.pulseUntil - ts) / 900;
          ctx.beginPath();
          ctx.lineWidth = 2;
          ctx.strokeStyle = hexAlpha(doneColor, Math.max(0, 0.6 * (1 - p)));
          ctx.arc(nd.x, nd.y, r + p * 20, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.fillStyle = isNodeDone ? doneColor : amberDim;
        if (isNodeDone) { ctx.shadowColor = doneColor; ctx.shadowBlur = 8; }
        ctx.arc(nd.x, nd.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      if (particles.length) {
        particles = particles.filter((p) => ts - p.start < 500);
        for (const p of particles) {
          const age = (ts - p.start) / 500;
          ctx.beginPath();
          ctx.fillStyle = hexAlpha(amber, 0.5 * (1 - age));
          ctx.arc(p.x, p.y, 2 + age * 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function step(ts) {
      rafId = requestAnimationFrame(step);
      try {
        if (document.hidden) return;
        if (ts - lastFrame < 33) return; // throttle to ~30fps
        lastFrame = ts;
        draw(ts);
      } catch (e) {
        // A draw error shouldn't crash the loop or the page — stop cleanly.
        stopLoop();
      }
    }

    function startLoop() {
      if (rafId) return;
      lastFrame = 0;
      rafId = requestAnimationFrame(step);
    }
    function stopLoop() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    }

    function applyState() {
      enabled = resolveEnabled();
      document.documentElement.classList.toggle('crt-on', enabled);
      const btn = document.getElementById('fxBtn');
      if (btn) btn.classList.toggle('on', enabled);
      if (canvas) canvas.style.visibility = enabled ? 'visible' : 'hidden';
      if (enabled) startLoop();
      else { stopLoop(); if (ctx) ctx.clearRect(0, 0, W, H); }
    }

    const FXImpl = {
      init() {
        try {
          const persisted = fxStore.get(KEY);
          state = (persisted === 'on' || persisted === 'off' || persisted === 'auto') ? persisted : 'auto';
          reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

          canvas = document.getElementById('bgfx');
          if (canvas) ctx = canvas.getContext('2d');
          if (canvas && ctx) {
            fit();
            if (!resizeBound) {
              window.addEventListener('resize', () => { try { fit(); } catch (e) {} });
              document.addEventListener('visibilitychange', () => { /* step() checks document.hidden each tick */ });
              resizeBound = true;
            }
          }

          const btn = document.getElementById('fxBtn');
          if (btn) {
            if (reducedMotion) {
              btn.disabled = true;
              btn.title = 'reduced motion';
              btn.style.opacity = '.4';
              btn.style.cursor = 'default';
            } else {
              btn.title = '';
              btn.disabled = false;
            }
          }

          applyState();
        } catch (e) {
          try { stopLoop(); } catch (e2) {}
          window.FX = NOOP;
        }
      },

      setEnabled(b) {
        try {
          if (reducedMotion) return; // kill switch stays off; button is disabled anyway
          state = b ? 'on' : 'off';
          fxStore.set(KEY, state);
          applyState();
        } catch (e) {}
      },

      isEnabled() {
        try { return !!enabled; } catch (e) { return false; }
      },

      onThemeChange() {
        try { if (state === 'auto') applyState(); } catch (e) {}
      },

      captureCascade(toLevel) {
        try {
          if (!enabled) return; // coherent: fully off means no residual fx anywhere
          const rows = Array.prototype.slice.call(document.querySelectorAll('.lrow'));
          rows.forEach((row, i) => {
            setTimeout(() => {
              try {
                row.classList.add('cascade');
                setTimeout(() => { try { row.classList.remove('cascade'); } catch (e) {} }, 400);
              } catch (e) {}
            }, i * 40);
          });
          const nd = nodes.find((n) => n.to === toLevel);
          if (nd) nd.pulseUntil = (performance.now ? performance.now() : Date.now()) + 900;
        } catch (e) {}
      },

      keystroke(x, y) {
        try {
          if (!enabled) return;
          particles.push({ x: x, y: y, start: (performance.now ? performance.now() : Date.now()) });
        } catch (e) {}
      },

      // --- debug helpers (not part of the callers' contract; used by the
      // browser verification pass to inspect internal loop/throttle state) ---
      _debug() {
        return { enabled: enabled, rafRunning: !!rafId, nodeCount: nodes.length, state: state, reducedMotion: reducedMotion };
      },
      // Synchronously runs one draw() pass regardless of RAF/visibility
      // throttling — lets automated verification confirm render correctness
      // without fighting a headless tab's real compositor-level rAF pause.
      _forceDraw() {
        try { draw(performance.now ? performance.now() : Date.now()); return true; } catch (e) { return false; }
      },
    };

    window.FX = FXImpl;
  } catch (e) {
    window.FX = NOOP;
  }
})();
