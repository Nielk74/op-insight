// src/spa.ts
// The entire client-side SPA as a template string.
// Injected verbatim into the <script> tag of the rendered HTML.
// No imports at runtime — all data comes from window.INSIGHTS_DATA.

export const SPA_SCRIPT = `
(function () {
  var data = window.INSIGHTS_DATA;
  var panels = ['trends', 'fingerprint', 'timeline', 'cards'];

  // ── Tab Navigation ──────────────────────────────────────────────
  function showTab(name) {
    panels.forEach(function(p) {
      document.getElementById('panel-' + p).style.display = p === name ? 'block' : 'none';
      document.getElementById('tab-' + p).classList.toggle('active', p === name);
    });
  }
  panels.forEach(function(p) {
    document.getElementById('tab-' + p).addEventListener('click', function() { showTab(p); });
  });

  // ── Canvas Helpers ───────────────────────────────────────────────
  function drawSparkline(canvas, values, color) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height, pad = 10;
    ctx.clearRect(0, 0, w, h);
    if (!values || !values.length) return;
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = max - min || 1;
    var pts = values.map(function(v, i) {
      return [
        pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2),
        (h - pad) - ((v - min) / range) * (h - pad * 2)
      ];
    });
    // Fill area under line
    ctx.beginPath();
    ctx.moveTo(pts[0][0], h - pad);
    pts.forEach(function(p) { ctx.lineTo(p[0], p[1]); });
    ctx.lineTo(pts[pts.length - 1][0], h - pad);
    ctx.closePath();
    ctx.fillStyle = color + '22';
    ctx.fill();
    // Line
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    pts.forEach(function(p, i) { i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]); });
    ctx.stroke();
    // Last-point dot (current week)
    var lp = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(lp[0], lp[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawRadar(canvas, scores, labels) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var cx = w / 2, cy = h / 2;
    var r = Math.min(cx, cy) - 40;
    var n = scores.length;
    var angle = function(i) { return (i * 2 * Math.PI / n) - Math.PI / 2; };
    ctx.clearRect(0, 0, w, h);
    // Grid rings
    [0.25, 0.5, 0.75, 1].forEach(function(ring) {
      ctx.beginPath();
      for (var i = 0; i < n; i++) {
        var x = cx + r * ring * Math.cos(angle(i));
        var y = cy + r * ring * Math.sin(angle(i));
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    // Axis lines
    for (var i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i)));
      ctx.strokeStyle = '#cbd5e1';
      ctx.stroke();
    }
    // Score polygon
    ctx.beginPath();
    scores.forEach(function(s, i) {
      var x = cx + r * s * Math.cos(angle(i));
      var y = cy + r * s * Math.sin(angle(i));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(8,145,178,0.15)';
    ctx.fill();
    ctx.strokeStyle = '#0891b2';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Vertex dots
    scores.forEach(function(s, i) {
      ctx.beginPath();
      ctx.arc(cx + r * s * Math.cos(angle(i)), cy + r * s * Math.sin(angle(i)), 4, 0, Math.PI * 2);
      ctx.fillStyle = '#0891b2';
      ctx.fill();
    });
    // Labels
    ctx.fillStyle = '#334155';
    ctx.font = '11px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    labels.forEach(function(label, i) {
      var x = cx + (r + 26) * Math.cos(angle(i));
      var y = cy + (r + 26) * Math.sin(angle(i));
      ctx.fillText(label, x, y);
    });
  }

  // ── Trends Panel ────────────────────────────────────────────────
  function renderTrends() {
    var trends = data.trends;
    var configs = [
      { key: 'avgTurnDepth',  label: 'Avg Turn Depth',   color: '#0891b2', fmt: function(v){ return v.toFixed(1); } },
      { key: 'errorRate',     label: 'Error Rate',        color: '#ef4444', fmt: function(v){ return (v*100).toFixed(0)+'%'; } },
      { key: 'toolDiversity', label: 'Tool Diversity',    color: '#8b5cf6', fmt: function(v){ return v.toFixed(1)+' tools'; } },
      { key: 'avgWasteScore', label: 'Avg Waste Score',   color: '#f59e0b', fmt: function(v){ return v.toFixed(1); } },
    ];
    var grid = document.getElementById('trends-grid');
    configs.forEach(function(cfg) {
      var values = trends.map(function(t) { return t[cfg.key]; });
      var latest = values[values.length - 1] || 0;
      var card = document.createElement('div');
      card.className = 'spark-card';
      var canvas = document.createElement('canvas');
      canvas.width = 200; canvas.height = 60;
      canvas.className = 'spark-canvas';
      card.innerHTML =
        '<div class="spark-label">' + cfg.label + '</div>' +
        '<div class="spark-value">' + cfg.fmt(latest) + '</div>';
      card.appendChild(canvas);
      if (trends.length) {
        var first = trends[0].week, last = trends[trends.length-1].week;
        var range = document.createElement('div');
        range.className = 'spark-weeks';
        range.textContent = first + ' \u2192 ' + last;
        card.appendChild(range);
      }
      grid.appendChild(card);
      drawSparkline(canvas, values, cfg.color);
    });
  }

  // ── Fingerprint Panel ───────────────────────────────────────────
  function renderFingerprint() {
    var fp = data.fingerprint;
    var axes = ['Autonomy', 'Breadth', 'Iteration', 'Tool Diversity', 'Output Density'];
    var scores = [fp.autonomy, fp.breadth, fp.iteration, fp.toolDiversity, fp.outputDensity];
    var canvas = document.getElementById('radar-canvas');
    drawRadar(canvas, scores, axes);
    var sessions = data.current.sessions;
    var avgTurnDepth = sessions.length ? (sessions.reduce(function(s,f){return s+f.turnDepth;},0)/sessions.length).toFixed(1) : '0';
    var allProjects = new Set(sessions.map(function(s){return s.projectName;}));
    var avgWaste = sessions.length ? (sessions.reduce(function(s,f){return s+f.wasteScore;},0)/sessions.length).toFixed(1) : '0';
    var allTools = new Set(sessions.flatMap ? sessions.flatMap(function(s){return s.toolsUsed;}) : []);
    var avgFiles = sessions.length ? (sessions.reduce(function(s,f){return s+(f.filesTouched||[]).length;},0)/sessions.length).toFixed(1) : '0';
    var descs = [
      'Autonomy: avg ' + avgTurnDepth + ' turns per session (higher = you let it run longer)',
      'Breadth: ' + allProjects.size + ' distinct projects this period',
      'Iteration: avg waste score ' + avgWaste + '/10 (lower is cleaner)',
      'Tool diversity: ' + allTools.size + ' unique tools used this period',
      'Output density: avg ' + avgFiles + ' files touched per session',
    ];
    var list = document.getElementById('fp-descriptions');
    descs.forEach(function(d) {
      var li = document.createElement('li');
      li.textContent = d;
      list.appendChild(li);
    });
  }

  // ── Timeline Panel ──────────────────────────────────────────────
  function wasteColor(score) {
    if (score <= 1) return '#22c55e';
    if (score <= 4) return '#f59e0b';
    return '#ef4444';
  }

  function renderTimeline() {
    var sessions = data.current.sessions;
    var projectSet = {};
    sessions.forEach(function(s) { projectSet[s.projectName] = true; });
    var projects = Object.keys(projectSet);
    var dates = sessions.map(function(s){ return s.date; }).sort();
    var minMs = dates.length ? new Date(dates[0]).getTime() : Date.now();
    var maxMs = dates.length ? new Date(dates[dates.length-1]).getTime() : Date.now();
    var span = Math.max(maxMs - minMs, 1);
    var container = document.getElementById('timeline-rows');
    projects.forEach(function(proj) {
      var row = document.createElement('div');
      row.className = 'tl-row';
      var label = document.createElement('div');
      label.className = 'tl-label';
      label.textContent = proj;
      var track = document.createElement('div');
      track.className = 'tl-track';
      sessions.filter(function(s){ return s.projectName === proj; }).forEach(function(s) {
        var dot = document.createElement('div');
        dot.className = 'tl-dot';
        var pct = ((new Date(s.date).getTime() - minMs) / span) * 100;
        var size = 8 + Math.min(s.turnDepth || 0, 8) * 2;
        dot.style.left = pct + '%';
        dot.style.width = size + 'px';
        dot.style.height = size + 'px';
        dot.style.background = wasteColor(s.wasteScore || 0);
        dot.style.marginTop = '-' + (size/2) + 'px';
        dot.title = s.date + ' \u00b7 ' + s.firstUserMessage.slice(0, 80);
        dot.addEventListener('click', (function(sid) {
          return function() {
            showTab('cards');
            setTimeout(function() {
              var card = document.getElementById('card-' + sid);
              if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('highlight');
                setTimeout(function(){ card.classList.remove('highlight'); }, 2000);
              }
            }, 60);
          };
        })(s.sessionId));
        track.appendChild(dot);
      });
      row.appendChild(label);
      row.appendChild(track);
      container.appendChild(row);
    });
  }

  // ── Session Cards Panel ─────────────────────────────────────────
  function fmtDuration(ms) {
    if (!ms || ms < 1000) return '\u2014';
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    return Math.floor(s/60) + 'm ' + (s%60) + 's';
  }

  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderCards() {
    var sessions = data.current.sessions.slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
    var container = document.getElementById('cards-list');
    sessions.forEach(function(s) {
      var card = document.createElement('div');
      card.className = 'sess-card';
      card.id = 'card-' + s.sessionId;
      var wasteBadge = (s.wasteScore || 0) >= 3
        ? '<span class="waste-badge">\u26a0 waste ' + s.wasteScore + '</span>' : '';
      var toolPills = (s.toolsUsed || []).map(function(t){ return '<span class="tool-pill">' + esc(t) + '</span>'; }).join('');
      var fileList = (s.filesTouched || []).length
        ? '<div class="detail-row"><strong>Files:</strong><ul class="detail-list">' +
          s.filesTouched.map(function(f){ return '<li>' + esc(f) + '</li>'; }).join('') +
          '</ul></div>' : '';
      var errList = (s.errorSnippets || []).length
        ? '<div class="detail-row"><strong>Errors:</strong><ul class="detail-list">' +
          s.errorSnippets.map(function(e){ return '<li>' + esc(e) + '</li>'; }).join('') +
          '</ul></div>' : '';
      var mc = s.messageCounts || { user: 0, assistant: 0 };
      card.innerHTML =
        '<div class="card-header" onclick="this.parentElement.classList.toggle(\'open\')">' +
          '<div class="card-meta"><span class="card-date">' + esc(s.date) + '</span>' +
          '<span class="card-project">' + esc(s.projectName) + '</span>' + wasteBadge + '</div>' +
          '<div class="card-msg">' + esc(s.firstUserMessage.slice(0, 120)) + '</div>' +
          '<div class="card-tools">' + toolPills + '</div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="detail-row"><strong>Turns:</strong> ' + (s.turnDepth||0) +
          ' &nbsp;&middot;&nbsp; <strong>Duration:</strong> ' + fmtDuration(s.duration) + '</div>' +
          '<div class="detail-row"><strong>Messages:</strong> ' + mc.user + ' user &nbsp;&middot;&nbsp; ' + mc.assistant + ' assistant</div>' +
          fileList + errList +
        '</div>';
      container.appendChild(card);
    });
  }

  // ── Init ────────────────────────────────────────────────────────
  showTab('trends');
  renderTrends();
  renderFingerprint();
  renderTimeline();
  renderCards();
})();
`
