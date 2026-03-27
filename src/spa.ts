// src/spa.ts
// The entire client-side SPA as a template string.
// Injected verbatim into the <script> tag of the rendered HTML.
// No imports at runtime — all data comes from window.INSIGHTS_DATA.

export const SPA_SCRIPT = `
(function () {
  var data = window.INSIGHTS_DATA;
  var panels = ['summary', 'trends', 'fingerprint', 'timeline', 'cards'];

  // ── Tab Navigation ──────────────────────────────────────────────
  function showTab(name) {
    panels.forEach(function(p) {
      document.getElementById('panel-' + p).style.display = p === name ? 'block' : 'none';
      document.getElementById('tab-' + p).classList.toggle('active', p === name);
    });
  }
  window.showTab = showTab;
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
      ctx.strokeStyle = '#d0d7de';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    // Axis lines
    for (var i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i)));
      ctx.strokeStyle = '#d0d7de';
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
    ctx.fillStyle = '#57606a';
    ctx.font = '11px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    labels.forEach(function(label, i) {
      var x = cx + (r + 26) * Math.cos(angle(i));
      var y = cy + (r + 26) * Math.sin(angle(i));
      ctx.fillText(label, x, y);
    });
  }

  // ── Summary Panel ───────────────────────────────────────────────
  // Coerce a value that might be string, array, or object to a display string
  function toStr(v) {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(function(x) { return toStr(x); }).join('. ');
    if (typeof v === 'object') return Object.values(v).map(function(x) { return toStr(x); }).join('. ');
    return String(v);
  }

  function copyText(id, btn) {
    var el = document.getElementById(id);
    if (!el) return;
    navigator.clipboard.writeText(el.textContent || '').then(function() {
      btn.textContent = 'Copied!';
      setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
    }).catch(function() {
      var r = document.createRange(); r.selectNodeContents(el);
      var sel = window.getSelection(); if (sel) { sel.removeAllRanges(); sel.addRange(r); }
    });
  }
  window.copyText = copyText;

  function renderSummary() {
    var s = data.summary;
    var container = document.getElementById('panel-summary');
    var sessions = data.current.sessions;
    var totalMsgs = sessions.reduce(function(a, b) { return a + b.messageCount; }, 0);
    var avgTurns = sessions.length ? (sessions.reduce(function(a,b){return a+b.turnDepth;},0)/sessions.length).toFixed(1) : '0';

    var parts = [];

    // ── Stats bar ────────────────────────────────────────────────────
    parts.push(
      '<div class="stats-bar">' +
        '<div class="stat"><div class="stat-val">' + sessions.length + '</div><div class="stat-lbl">Sessions</div></div>' +
        '<div class="stat"><div class="stat-val">' + totalMsgs + '</div><div class="stat-lbl">Messages</div></div>' +
        '<div class="stat"><div class="stat-val">' + avgTurns + '</div><div class="stat-lbl">Avg turns</div></div>' +
        '<div class="stat"><div class="stat-val">' + data.current.periodDays + 'd</div><div class="stat-lbl">Period</div></div>' +
      '</div>'
    );

    if (!s) {
      parts.push('<p class="muted">No LLM summary available. Re-generate the report to populate this panel.</p>');
      container.innerHTML = parts.join('');
      return;
    }

    // ── At a Glance ──────────────────────────────────────────────────
    var glance = s.atAGlance || {};
    // Computed fallbacks when LLM left fields empty
    if (!toStr(glance.workingWell)) {
      var tc = {}; sessions.flatMap(function(x){return x.toolsUsed||[];}).forEach(function(t){ tc[t]=(tc[t]||0)+1; });
      var st = Object.entries(tc).sort(function(a,b){return b[1]-a[1];}).slice(0,3).map(function(e){return e[0];});
      glance.workingWell = st.length ? 'Most-used tools: ' + st.join(', ') + '.' : 'No tool data available.';
    }
    if (!toStr(glance.hindering)) {
      var ws = sessions.filter(function(x){return (x.wasteScore||0)>=3;});
      glance.hindering = ws.length ? ws.length + ' session(s) had high waste scores (repeated tool retries).' : 'No significant friction detected.';
    }
    if (!toStr(glance.quickWins)) {
      glance.quickWins = 'Add an AGENTS.md at your repo root and set "instructions" in opencode.json to load it automatically.';
    }
    parts.push(
      '<div class="summary-section"><h2 class="section-title">At a Glance</h2>' +
        '<div class="glance-grid">' +
          '<div class="glance-card glance-good"><div class="glance-label">\u2705 What\u2019s working</div><p>' + esc(toStr(glance.workingWell)) + '</p></div>' +
          '<div class="glance-card glance-bad"><div class="glance-label">\u26a0\ufe0f What\u2019s hindering you</div><p>' + esc(toStr(glance.hindering)) + '</p></div>' +
          '<div class="glance-card glance-tip"><div class="glance-label">\u26a1 Quick wins to try</div><p>' + esc(toStr(glance.quickWins)) + '</p></div>' +
        '</div>' +
      '</div>'
    );

    // ── Behavioral profile ───────────────────────────────────────────
    if (toStr(s.behavioralProfile)) {
      parts.push(
        '<div class="summary-section"><h2 class="section-title">How You Use opencode</h2>' +
          '<p class="profile-text">' + esc(toStr(s.behavioralProfile)) + '</p>' +
        '</div>'
      );
    }

    // ── Impressive things ────────────────────────────────────────────
    var impressive = s.impressiveThings || [];
    if (impressive.length) {
      parts.push('<div class="summary-section"><h2 class="section-title">Impressive Things You Did</h2><div class="rich-grid">');
      impressive.forEach(function(item) {
        var title = toStr(item.title || item.name || '');
        var para  = toStr(item.paragraph || item.detail || item.description || '');
        parts.push(
          '<div class="rich-card rich-card-good">' +
            (title ? '<h3 class="rich-card-title">' + esc(title) + '</h3>' : '') +
            (para  ? '<p>' + esc(para) + '</p>' : '') +
          '</div>'
        );
      });
      parts.push('</div></div>');
    }

    // ── Where things go wrong ────────────────────────────────────────
    var wrong = s.whereThingsGoWrong || [];
    // fallback: migrate legacy frictionPoints
    if (!wrong.length && s.workflowInsights && s.workflowInsights.frictionPoints) {
      wrong = s.workflowInsights.frictionPoints.map(function(fp) {
        return { title: fp.title, paragraph: fp.detail, examples: fp.examples || [] };
      });
    }
    if (wrong.length) {
      parts.push('<div class="summary-section"><h2 class="section-title">Where Things Go Wrong</h2><div class="rich-grid">');
      wrong.forEach(function(item) {
        var title = toStr(item.title || '');
        var para  = toStr(item.paragraph || item.detail || '');
        var exs   = Array.isArray(item.examples) ? item.examples : [];
        parts.push(
          '<div class="rich-card rich-card-bad">' +
            (title ? '<h3 class="rich-card-title">' + esc(title) + '</h3>' : '') +
            (para  ? '<p>' + esc(para) + '</p>' : '') +
            (exs.length ? '<ul class="rich-examples">' + exs.map(function(e){ return '<li>' + esc(toStr(e)) + '</li>'; }).join('') + '</ul>' : '') +
          '</div>'
        );
      });
      parts.push('</div></div>');
    }

    // ── Features to try ──────────────────────────────────────────────
    var features = s.featuresToTry || [];
    // fallback: migrate legacy featureRecommendations
    if (!features.length && s.featureRecommendations) {
      features = s.featureRecommendations.map(function(r) {
        return { title: r.title || '', why: r.why || '', pasteInto: '', target: '' };
      });
    }
    if (features.length) {
      parts.push('<div class="summary-section"><h2 class="section-title">Features & Practices to Try</h2><div class="feature-list">');
      features.forEach(function(feat, idx) {
        var pasteId = 'paste-feat-' + idx;
        var title  = toStr(feat.title || '');
        var why    = toStr(feat.why || '');
        var paste  = toStr(feat.pasteInto || '');
        var target = toStr(feat.target || 'Copy');
        parts.push('<div class="feature-card">');
        if (title) parts.push('<h3 class="rich-card-title">' + esc(title) + '</h3>');
        if (why)   parts.push('<p class="feature-why">' + esc(why) + '</p>');
        if (paste) {
          parts.push(
            '<div class="feature-paste-header">' +
              '<span class="feature-paste-label">' + esc(target) + '</span>' +
              '<button class="copy-btn" data-paste-id="' + pasteId + '" onclick="copyText(this.dataset.pasteId, this)">Copy</button>' +
            '</div>' +
            '<pre class="feature-paste-block" id="' + pasteId + '">' + esc(paste) + '</pre>'
          );
        }
        parts.push('</div>');
      });
      parts.push('</div></div>');
    }

    container.innerHTML = parts.join('');
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

    // Time-of-day bar chart (uses all history sessions)
    var allSessions = (function() {
      var seen = {};
      var out = [];
      data.history.forEach(function(e) { e.sessions.forEach(function(s) { if (!seen[s.sessionId]) { seen[s.sessionId] = true; out.push(s); } }); });
      data.current.sessions.forEach(function(s) { if (!seen[s.sessionId]) { seen[s.sessionId] = true; out.push(s); } });
      return out;
    })();
    var hourCounts = new Array(24).fill(0);
    allSessions.forEach(function(s) { if (s.hourOfDay != null) hourCounts[s.hourOfDay]++; });
    var maxHour = Math.max.apply(null, hourCounts) || 1;

    var todCard = document.createElement('div');
    todCard.className = 'spark-card tod-card';
    todCard.style.gridColumn = '1 / -1';
    todCard.innerHTML = '<div class="spark-label">Sessions by Time of Day (all history)</div>';
    var todCanvas = document.createElement('canvas');
    todCanvas.width = 700; todCanvas.height = 80;
    todCard.appendChild(todCanvas);
    grid.appendChild(todCard);

    var tc = todCanvas.getContext('2d');
    var tw = todCanvas.width, th = todCanvas.height;
    var barW = tw / 24;
    var labels = ['12a','','2a','','4a','','6a','','8a','','10a','','12p','','2p','','4p','','6p','','8p','','10p',''];
    hourCounts.forEach(function(count, h) {
      var bh = Math.max((count / maxHour) * (th - 18), count > 0 ? 2 : 0);
      var x = h * barW;
      tc.fillStyle = (h >= 9 && h <= 18) ? '#0969da' : '#8bc0f0';
      tc.fillRect(x + 1, th - 16 - bh, barW - 2, bh);
      if (labels[h]) {
        tc.fillStyle = '#57606a';
        tc.font = '9px system-ui,sans-serif';
        tc.textAlign = 'center';
        tc.fillText(labels[h], x + barW / 2, th - 2);
      }
    });
  }

  // ── Fingerprint Panel ───────────────────────────────────────────
  function renderFingerprint() {
    var fp = data.fingerprint;
    var axes = ['Autonomy', 'Frequency', 'Iteration', 'Tool Diversity', 'Output Density'];
    var scores = [fp.autonomy, fp.sessionFrequency, fp.iteration, fp.toolDiversity, fp.outputDensity];
    var canvas = document.getElementById('radar-canvas');
    drawRadar(canvas, scores, axes);
    var sessions = data.current.sessions;
    var avgTurnDepth = sessions.length ? (sessions.reduce(function(s,f){return s+f.turnDepth;},0)/sessions.length).toFixed(1) : '0';
    var avgWaste = sessions.length ? (sessions.reduce(function(s,f){return s+f.wasteScore;},0)/sessions.length).toFixed(1) : '0';
    var allTools = new Set(sessions.flatMap ? sessions.flatMap(function(s){return s.toolsUsed;}) : []);
    var avgFiles = sessions.length ? (sessions.reduce(function(s,f){return s+(f.filesTouched||[]).length;},0)/sessions.length).toFixed(1) : '0';
    var freqVal = fp.sessionFrequency ? (fp.sessionFrequency * 10).toFixed(1) : '0';
    var descs = [
      'Autonomy: avg ' + avgTurnDepth + ' turns per session (higher = you let it run longer)',
      'Frequency: avg ' + freqVal + ' sessions per week over the last 90 days',
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
    var dates = sessions.map(function(s){ return s.date; }).sort();
    var minMs = dates.length ? new Date(dates[0]).getTime() : Date.now();
    var maxMs = dates.length ? new Date(dates[dates.length-1]).getTime() : Date.now();
    var singleDay = minMs === maxMs;
    var span = singleDay ? 1 : (maxMs - minMs);
    var container = document.getElementById('timeline-rows');

    // Group sessions by calendar week (Monday date)
    var weekMap = {};
    sessions.forEach(function(s) {
      var d = new Date(s.date);
      var day = d.getUTCDay();
      var diff = (day === 0) ? -6 : 1 - day;
      d.setUTCDate(d.getUTCDate() + diff);
      var wk = d.toISOString().slice(0, 10);
      if (!weekMap[wk]) weekMap[wk] = [];
      weekMap[wk].push(s);
    });
    var weeks = Object.keys(weekMap).sort();

    weeks.forEach(function(wk) {
      var row = document.createElement('div');
      row.className = 'tl-row';
      var label = document.createElement('div');
      label.className = 'tl-label';
      label.textContent = wk;
      var track = document.createElement('div');
      track.className = 'tl-track';
      var wkSessions = weekMap[wk];
      wkSessions.forEach(function(s, idx) {
        var dot = document.createElement('div');
        dot.className = 'tl-dot';
        // Within a week row, spread by day-of-week (0=Mon … 6=Sun → 0%–100%)
        var d = new Date(s.date);
        var dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
        var basePct = (dow / 6) * 90 + 5;
        // Jitter same-day dots slightly so they don't overlap
        var sameDayIdx = wkSessions.filter(function(x){ return x.date === s.date; }).indexOf(s);
        var pct = singleDay
          ? (wkSessions.length === 1 ? 50 : (idx / (wkSessions.length - 1)) * 90 + 5)
          : basePct + sameDayIdx * 2.5;
        var size = 10 + Math.min(s.turnDepth || 0, 6) * 2;
        dot.style.left = pct + '%';
        dot.style.width = size + 'px';
        dot.style.height = size + 'px';
        dot.style.background = wasteColor(s.wasteScore || 0);
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
    var allSessions = data.current.sessions.slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
    var CAP = 50;
    var sessions = allSessions.slice(0, CAP);
    var container = document.getElementById('cards-list');
    if (allSessions.length > CAP) {
      var note = document.createElement('div');
      note.className = 'muted';
      note.textContent = 'Showing ' + CAP + ' of ' + allSessions.length + ' sessions (most recent first)';
      container.appendChild(note);
    }
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
        '<div class="card-header">' +
          '<div class="card-meta"><span class="card-date">' + esc(s.date) + '</span>' + wasteBadge + '</div>' +
          '<div class="card-msg">' + esc(s.firstUserMessage.slice(0, 120)) + '</div>' +
          '<div class="card-tools">' + toolPills + '</div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="detail-row"><strong>Turns:</strong> ' + (s.turnDepth||0) +
          ' &nbsp;&middot;&nbsp; <strong>Duration:</strong> ' + fmtDuration(s.duration) + '</div>' +
          '<div class="detail-row"><strong>Messages:</strong> ' + mc.user + ' user &nbsp;&middot;&nbsp; ' + mc.assistant + ' assistant</div>' +
          fileList + errList +
        '</div>';
      card.querySelector('.card-header').addEventListener('click', function() {
        card.classList.toggle('open');
      });
      container.appendChild(card);
    });
  }

  // ── Init ────────────────────────────────────────────────────────
  showTab('summary');
  var titleEl = document.getElementById('nav-title');
  if (titleEl) {
    var d = new Date(data.current.runAt);
    titleEl.textContent = data.current.periodDays + 'd \u00b7 ' + data.current.sessions.length + ' sessions \u00b7 ' + d.toLocaleDateString();
  }
  renderSummary();
  renderTrends();
  renderFingerprint();
  renderTimeline();
  renderCards();
})();
`
