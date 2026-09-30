/**
 * Single-file responsive Obsidian dark-mode dashboard SPA for Pi Agent MCP.
 * Zero external build steps; uses Tailwind CSS via CDN and native ES6 JavaScript.
 */

export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>⚡ Pi Agent Dashboard | pi-agent-mcp</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            obsidian: {
              DEFAULT: '#0d0f12',
              surface: '#13171f',
              card: '#181d27',
              border: '#1f2633',
              hover: '#252e3d',
              terminal: '#07090e',
            }
          },
          fontFamily: {
            mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', 'monospace'],
            sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
          }
        }
      }
    };
  </script>
  <style>
    /* Custom scrollbars */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: #0d0f12;
    }
    ::-webkit-scrollbar-thumb {
      background: #252e3d;
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #3b465a;
    }
    @keyframes pulse-slow {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .animate-pulse-slow {
      animation: pulse-slow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
  </style>
</head>
<body class="bg-obsidian text-slate-200 min-h-screen font-sans antialiased selection:bg-indigo-500 selection:text-white flex flex-col">

  <!-- Top Navigation Header -->
  <header class="sticky top-0 z-40 bg-obsidian-surface/90 backdrop-blur border-b border-obsidian-border px-4 py-3 sm:px-6">
    <div class="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
      
      <!-- Logo and Titles -->
      <div class="flex items-center space-x-3 w-full sm:w-auto justify-between sm:justify-start">
        <div class="flex items-center space-x-3">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-violet-500 to-amber-400 p-[1px] shadow-lg shadow-indigo-500/20">
            <div class="w-full h-full bg-obsidian rounded-[11px] flex items-center justify-center">
              <span class="text-amber-400 text-lg">⚡</span>
            </div>
          </div>
          <div>
            <div class="flex items-center space-x-2">
              <span class="font-bold text-base tracking-tight text-white">pi-agent-mcp</span>
              <span class="text-[10px] font-semibold uppercase tracking-wider bg-indigo-950/80 text-indigo-300 border border-indigo-700/50 px-2 py-0.5 rounded-full">v1.0.0</span>
            </div>
            <p class="text-xs text-slate-400 hidden sm:block">Autonomous Worker & Model Monitor</p>
          </div>
        </div>

        <!-- Connection Badge on Mobile -->
        <div class="sm:hidden flex items-center">
          <span id="conn-pill-mobile" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/60 border border-emerald-800/50 text-emerald-300">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span id="port-label-mobile">Port 7081</span>
          </span>
        </div>
      </div>

      <!-- Quick Metrics & Status Pills -->
      <div class="flex flex-wrap items-center gap-2 sm:gap-3 text-xs w-full sm:w-auto justify-end">
        <div class="bg-obsidian-card border border-obsidian-border rounded-lg px-3 py-1.5 flex items-center gap-2">
          <span class="text-slate-400">Workers:</span>
          <span id="metric-workers" class="font-bold text-amber-400">0</span>
        </div>
        <div class="bg-obsidian-card border border-obsidian-border rounded-lg px-3 py-1.5 flex items-center gap-2">
          <span class="text-slate-400">Providers:</span>
          <span id="metric-providers" class="font-bold text-sky-400">0</span>
        </div>
        <div class="bg-obsidian-card border border-obsidian-border rounded-lg px-3 py-1.5 flex items-center gap-2 max-w-[200px] truncate" title="Default Model">
          <span class="text-slate-400">Default:</span>
          <span id="metric-default-model" class="font-bold text-indigo-300 truncate">Loading...</span>
        </div>
        <div class="hidden sm:flex items-center">
          <span id="conn-pill" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-950/60 border border-emerald-800/50 text-emerald-300">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span id="port-label">Port 7081</span>
          </span>
        </div>
      </div>

    </div>
  </header>

  <!-- Navigation Tabs Bar -->
  <nav class="bg-obsidian-surface/60 border-b border-obsidian-border px-4 sm:px-6">
    <div class="max-w-7xl mx-auto flex space-x-1 sm:space-x-4">
      <button id="tab-btn-workers" onclick="switchTab('workers')" class="tab-btn py-3 px-4 text-xs sm:text-sm font-medium border-b-2 border-indigo-500 text-white flex items-center gap-2">
        <span>⚡</span> Live Workers & Logs
        <span id="active-badge" class="hidden ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-black font-bold">1</span>
      </button>
      <button id="tab-btn-models" onclick="switchTab('models')" class="tab-btn py-3 px-4 text-xs sm:text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2">
        <span>⚙️</span> Model & MCP Settings
      </button>
      <button id="tab-btn-doctor" onclick="switchTab('doctor')" class="tab-btn py-3 px-4 text-xs sm:text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2">
        <span>🩺</span> Doctor Diagnostics
      </button>
    </div>
  </nav>

  <!-- Notification Toast Container -->
  <div id="toast-container" class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none"></div>

  <!-- Main Content Areas -->
  <main class="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6">

    <!-- ========================================== -->
    <!-- TAB 1: LIVE WORKERS & LOGS                 -->
    <!-- ========================================== -->
    <div id="tab-content-workers" class="tab-pane space-y-6">
      
      <!-- Active Worker Cards Container -->
      <section>
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-300">Active Autonomous Workers</h2>
            <span id="workers-count-pill" class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-obsidian-card border border-obsidian-border text-slate-300">0</span>
          </div>
          <span class="text-xs text-slate-500">Real-time SSE Stream</span>
        </div>

        <div id="active-workers-container" class="space-y-4">
          <!-- Empty State (default) -->
          <div id="empty-workers-state" class="bg-obsidian-card border border-obsidian-border rounded-xl p-8 text-center">
            <div class="w-12 h-12 mx-auto rounded-full bg-obsidian flex items-center justify-center text-slate-500 text-xl mb-3 border border-obsidian-border">
              ⚡
            </div>
            <h3 class="text-sm font-medium text-slate-300 mb-1">No active workers</h3>
            <p class="text-xs text-slate-500 max-w-md mx-auto">
              Autonomous workers dispatched via <code class="text-slate-400 bg-obsidian px-1.5 py-0.5 rounded">pi_run_task</code>, <code class="text-slate-400 bg-obsidian px-1.5 py-0.5 rounded">run_pi_worker</code>, or DeepSeek Harness will stream logs and live activity here in real-time.
            </p>
          </div>
        </div>
      </section>

      <!-- Task Execution History Table -->
      <section class="mt-8">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-300">Recent Task History</h2>
          <button onclick="clearHistory()" class="text-xs text-slate-500 hover:text-slate-300 transition-colors">Clear History</button>
        </div>

        <div class="bg-obsidian-card border border-obsidian-border rounded-xl overflow-hidden shadow-sm">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-obsidian-surface border-b border-obsidian-border text-slate-400 uppercase tracking-wider text-[11px]">
                <tr>
                  <th class="py-3 px-4">Status</th>
                  <th class="py-3 px-4">Task Brief</th>
                  <th class="py-3 px-4">Model</th>
                  <th class="py-3 px-4">Duration</th>
                  <th class="py-3 px-4">Files</th>
                  <th class="py-3 px-4 text-right">Completed</th>
                </tr>
              </thead>
              <tbody id="history-table-body" class="divide-y divide-obsidian-border text-slate-300">
                <tr id="empty-history-row">
                  <td colspan="6" class="py-6 text-center text-slate-500 italic">No tasks executed yet in this session.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

    </div>

    <!-- ========================================== -->
    <!-- TAB 2: MODEL & MCP SETTINGS                -->
    <!-- ========================================== -->
    <div id="tab-content-models" class="tab-pane hidden space-y-6">
      
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-obsidian-card border border-obsidian-border rounded-xl p-4 sm:p-5">
        <div>
          <h2 class="text-base font-bold text-white flex items-center gap-2">
            <span>⚙️</span> Pi Providers & Model Configuration
          </h2>
          <p class="text-xs text-slate-400 mt-1">
            Dynamic provider endpoints read directly from <code class="text-indigo-300">~/.pi/agent/models.json</code> and <code class="text-indigo-300">settings.json</code>.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <button onclick="fetchConfig()" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-obsidian border border-obsidian-border text-slate-300 hover:text-white hover:bg-obsidian-hover transition-colors flex items-center gap-1.5">
            <span>🔄</span> Refresh
          </button>
          <button onclick="openAddProviderModal()" class="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-1.5">
            <span>+</span> Add Provider
          </button>
        </div>
      </div>

      <!-- Providers Grid -->
      <div id="providers-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <!-- Injected via JavaScript -->
        <div class="p-8 text-center text-slate-500 col-span-full">Loading provider configuration...</div>
      </div>

    </div>

    <!-- ========================================== -->
    <!-- TAB 3: DOCTOR DIAGNOSTICS                  -->
    <!-- ========================================== -->
    <div id="tab-content-doctor" class="tab-pane hidden space-y-6">
      
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-obsidian-card border border-obsidian-border rounded-xl p-4 sm:p-5">
        <div>
          <h2 class="text-base font-bold text-white flex items-center gap-2">
            <span>🩺</span> System Doctor Diagnostics
          </h2>
          <p class="text-xs text-slate-400 mt-1">
            Validates Pi binary installation, CLI availability, and connectivity across all registered LLM providers.
          </p>
        </div>
        <button id="run-doctor-btn" onclick="runDoctorCheck()" class="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2">
          <span>🩺</span> Run Doctor Check
        </button>
      </div>

      <!-- Overall Status Banner -->
      <div id="doctor-summary-banner" class="bg-obsidian-card border border-obsidian-border rounded-xl p-5 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div id="doctor-status-icon" class="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-lg">
            ❓
          </div>
          <div>
            <div class="text-xs text-slate-400 uppercase tracking-wider font-semibold">Diagnostic Health</div>
            <div id="doctor-status-text" class="text-base font-bold text-slate-200">Not Run Yet</div>
          </div>
        </div>
        <div id="doctor-timestamp" class="text-xs text-slate-500 font-mono">Click button to run</div>
      </div>

      <!-- Pi Binary Check Card -->
      <div class="bg-obsidian-card border border-obsidian-border rounded-xl p-5">
        <h3 class="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-2">
          <span>💻</span> Pi Binary Environment
        </h3>
        <div id="doctor-binary-details" class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
          <div class="bg-obsidian p-3 rounded-lg border border-obsidian-border">
            <span class="text-slate-500 block text-[10px] uppercase">Installed</span>
            <span id="doc-bin-installed" class="text-slate-300 font-semibold">—</span>
          </div>
          <div class="bg-obsidian p-3 rounded-lg border border-obsidian-border truncate">
            <span class="text-slate-500 block text-[10px] uppercase">Path</span>
            <span id="doc-bin-path" class="text-slate-300 truncate" title="—">—</span>
          </div>
          <div class="bg-obsidian p-3 rounded-lg border border-obsidian-border">
            <span class="text-slate-500 block text-[10px] uppercase">Version</span>
            <span id="doc-bin-version" class="text-slate-300 font-semibold">—</span>
          </div>
        </div>
      </div>

      <!-- Providers Health Diagnostics Table -->
      <div class="bg-obsidian-card border border-obsidian-border rounded-xl overflow-hidden">
        <div class="p-4 border-b border-obsidian-border flex items-center justify-between">
          <h3 class="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <span>🌐</span> Model Endpoints Reachability
          </h3>
          <span class="text-xs text-slate-500">GET /api/doctor</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-obsidian-surface border-b border-obsidian-border text-slate-400 uppercase tracking-wider text-[11px]">
              <tr>
                <th class="py-3 px-4">Provider</th>
                <th class="py-3 px-4">Base URL</th>
                <th class="py-3 px-4">Default Model</th>
                <th class="py-3 px-4">Reachability</th>
                <th class="py-3 px-4">Latency</th>
                <th class="py-3 px-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody id="doctor-providers-tbody" class="divide-y divide-obsidian-border text-slate-300">
              <tr>
                <td colspan="6" class="py-6 text-center text-slate-500 italic">Run doctor check to test all provider endpoints.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>

  </main>

  <!-- Add Provider Modal -->
  <div id="add-provider-modal" class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm hidden flex items-center justify-center p-4">
    <div class="bg-obsidian-card border border-obsidian-border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
      <div class="p-5 border-b border-obsidian-border flex items-center justify-between">
        <h3 class="text-sm font-bold text-white flex items-center gap-2">
          <span>+</span> Add Custom Model Provider
        </h3>
        <button onclick="closeAddProviderModal()" class="text-slate-400 hover:text-white text-lg">&times;</button>
      </div>

      <form id="add-provider-form" onsubmit="handleAddProvider(event)" class="p-5 space-y-4 text-xs">
        <div>
          <label class="block text-slate-400 mb-1 font-medium">Provider ID (slug)</label>
          <input id="input-provider-id" type="text" required placeholder="e.g. vllm-local" class="w-full bg-obsidian border border-obsidian-border rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500">
        </div>
        <div>
          <label class="block text-slate-400 mb-1 font-medium">Display Name</label>
          <input id="input-provider-name" type="text" required placeholder="e.g. Local vLLM Inference" class="w-full bg-obsidian border border-obsidian-border rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500">
        </div>
        <div>
          <label class="block text-slate-400 mb-1 font-medium">Base URL (OpenAI-compatible /v1)</label>
          <input id="input-provider-url" type="url" required placeholder="http://localhost:8000/v1" class="w-full bg-obsidian border border-obsidian-border rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500">
        </div>
        <div>
          <label class="block text-slate-400 mb-1 font-medium">Default Model ID</label>
          <input id="input-provider-model" type="text" required placeholder="e.g. deepseek-ai/DeepSeek-V3" class="w-full bg-obsidian border border-obsidian-border rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500">
        </div>
        <div>
          <label class="block text-slate-400 mb-1 font-medium">API Key (optional)</label>
          <input id="input-provider-key" type="password" placeholder="sk-..." class="w-full bg-obsidian border border-obsidian-border rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500">
        </div>

        <div class="pt-3 flex justify-end gap-2 border-t border-obsidian-border">
          <button type="button" onclick="closeAddProviderModal()" class="px-3 py-1.5 rounded-lg border border-obsidian-border text-slate-400 hover:text-white">Cancel</button>
          <button type="submit" class="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">Save Provider</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Client-Side Dashboard Logic -->
  <script>
    // State
    const state = {
      activeWorkers: new Map(), // taskId -> { taskId, cwd, task, model, startTime, runningSec, logs }
      config: null,
      history: [],
      connected: false,
    };

    // Load persisted history from localStorage if available
    try {
      const saved = localStorage.getItem('pi_agent_history');
      if (saved) state.history = JSON.parse(saved);
    } catch {}

    // HTML Escaping
    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function formatDuration(sec) {
      const s = Math.max(0, Math.floor(sec || 0));
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return (m < 10 ? '0' : '') + m + ':' + (rem < 10 ? '0' : '') + rem;
    }

    function showToast(message, type = 'info') {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      const colors = {
        info: 'bg-indigo-950/90 border-indigo-700/60 text-indigo-200',
        success: 'bg-emerald-950/90 border-emerald-700/60 text-emerald-200',
        error: 'bg-rose-950/90 border-rose-700/60 text-rose-200',
        warn: 'bg-amber-950/90 border-amber-700/60 text-amber-200'
      };
      toast.className = 'px-4 py-2.5 rounded-xl border text-xs font-medium shadow-xl backdrop-blur transition-all duration-300 transform translate-y-2 ' + (colors[type] || colors.info);
      toast.innerHTML = escapeHtml(message);
      container.appendChild(toast);
      setTimeout(() => toast.classList.remove('translate-y-2'), 10);
      setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    // Switch Tabs
    function switchTab(tabName) {
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('border-indigo-500', 'text-white');
        btn.classList.add('border-transparent', 'text-slate-400');
      });
      document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.add('hidden'));

      const activeBtn = document.getElementById('tab-btn-' + tabName);
      if (activeBtn) {
        activeBtn.classList.remove('border-transparent', 'text-slate-400');
        activeBtn.classList.add('border-indigo-500', 'text-white');
      }
      const activePane = document.getElementById('tab-content-' + tabName);
      if (activePane) activePane.classList.remove('hidden');

      if (tabName === 'models') fetchConfig();
      if (tabName === 'doctor') runDoctorCheck();
    }

    // Timer Loop: increments runningSec for each active worker
    setInterval(() => {
      let updated = false;
      state.activeWorkers.forEach((worker, taskId) => {
        worker.runningSec = (worker.runningSec || 0) + 1;
        const timerEl = document.getElementById('timer-' + taskId);
        if (timerEl) {
          timerEl.textContent = formatDuration(worker.runningSec);
          updated = true;
        }
      });
    }, 1000);

    // Render Active Worker Cards
    function renderActiveWorkers() {
      const container = document.getElementById('active-workers-container');
      const countPill = document.getElementById('workers-count-pill');
      const metricWorkers = document.getElementById('metric-workers');
      const activeBadge = document.getElementById('active-badge');
      const count = state.activeWorkers.size;

      if (countPill) countPill.textContent = count;
      if (metricWorkers) metricWorkers.textContent = count;
      if (activeBadge) {
        activeBadge.textContent = count;
        activeBadge.classList.toggle('hidden', count === 0);
      }

      if (count === 0) {
        container.innerHTML = \`
          <div id="empty-workers-state" class="bg-obsidian-card border border-obsidian-border rounded-xl p-8 text-center">
            <div class="w-12 h-12 mx-auto rounded-full bg-obsidian flex items-center justify-center text-slate-500 text-xl mb-3 border border-obsidian-border">
              ⚡
            </div>
            <h3 class="text-sm font-medium text-slate-300 mb-1">No active workers</h3>
            <p class="text-xs text-slate-500 max-w-md mx-auto">
              Autonomous workers dispatched via <code class="text-slate-400 bg-obsidian px-1.5 py-0.5 rounded">pi_run_task</code>, <code class="text-slate-400 bg-obsidian px-1.5 py-0.5 rounded">run_pi_worker</code>, or DeepSeek Harness will stream logs and live activity here in real-time.
            </p>
          </div>\`;
        return;
      }

      // Check if existing cards need to be built or updated
      state.activeWorkers.forEach((worker, taskId) => {
        let card = document.getElementById('worker-card-' + taskId);
        if (!card) {
          card = document.createElement('div');
          card.id = 'worker-card-' + taskId;
          card.className = 'bg-obsidian-card border border-obsidian-border rounded-2xl overflow-hidden shadow-lg animate-in fade-in duration-200';
          
          card.innerHTML = \`
            <!-- Card Header -->
            <div class="p-4 sm:p-5 border-b border-obsidian-border bg-obsidian-surface flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <span class="w-3 h-3 rounded-full bg-amber-400 animate-ping"></span>
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-xs font-bold text-white">\${escapeHtml(taskId)}</span>
                    <span class="text-[10px] font-semibold uppercase bg-amber-950/80 text-amber-300 border border-amber-700/50 px-2 py-0.5 rounded-full">RUNNING</span>
                    <span class="text-[11px] font-mono text-indigo-300 bg-obsidian px-2 py-0.5 rounded border border-obsidian-border">\${escapeHtml(worker.model || 'FreeToken Qwen 35B')}</span>
                  </div>
                  <div class="text-[11px] text-slate-400 truncate mt-1 max-w-xl font-mono" title="\${escapeHtml(worker.cwd || '')}">
                    📂 \${escapeHtml(worker.cwd || '')}
                  </div>
                </div>
              </div>

              <!-- Live Clock & Abort Button -->
              <div class="flex items-center gap-3 self-end md:self-auto">
                <div class="text-right">
                  <span class="text-[10px] text-slate-500 uppercase block font-mono">Elapsed</span>
                  <span id="timer-\${taskId}" class="font-mono text-sm font-bold text-amber-300">\${formatDuration(worker.runningSec)}</span>
                </div>
                <button onclick="abortWorker('\${taskId}')" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600/90 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 transition-all flex items-center gap-1.5">
                  <span>⏹</span> Abort Worker
                </button>
              </div>
            </div>

            <!-- Task Brief Block -->
            <div class="px-4 py-3 bg-obsidian/40 border-b border-obsidian-border text-xs">
              <span class="text-slate-500 font-semibold uppercase tracking-wider text-[10px] block mb-1">Architect Task Brief</span>
              <p class="text-slate-300 whitespace-pre-wrap leading-relaxed font-sans">\${escapeHtml(worker.task || 'Executing autonomous task...')}</p>
            </div>

            <!-- Terminal Window -->
            <div class="bg-obsidian-terminal p-3 font-mono text-xs">
              <div class="flex items-center justify-between pb-2 mb-2 border-b border-obsidian-border/50 text-[11px] text-slate-400">
                <div class="flex items-center gap-2">
                  <div class="flex space-x-1.5">
                    <span class="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block"></span>
                    <span class="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block"></span>
                    <span class="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block"></span>
                  </div>
                  <span class="text-slate-400 font-mono text-[10px] ml-2">live-worker-stream.log</span>
                </div>
                <div class="flex items-center gap-3">
                  <span class="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> STREAMING
                  </span>
                  <button onclick="copyTerminalText('\${taskId}')" class="text-slate-400 hover:text-slate-200 text-[10px]">Copy</button>
                </div>
              </div>
              <pre id="terminal-\${taskId}" class="max-h-72 overflow-y-auto overflow-x-auto whitespace-pre-wrap leading-relaxed text-slate-300 selection:bg-indigo-600 select-text font-mono text-[11px]">\${escapeHtml(worker.logs || 'Connecting to output stream...')}</pre>
            </div>
          \`;

          const emptyState = document.getElementById('empty-workers-state');
          if (emptyState) emptyState.remove();
          container.appendChild(card);
        }
      });

      // Remove cards no longer in activeWorkers
      Array.from(container.children).forEach(child => {
        if (child.id && child.id.startsWith('worker-card-')) {
          const tid = child.id.replace('worker-card-', '');
          if (!state.activeWorkers.has(tid)) child.remove();
        }
      });
    }

    function appendTerminalLog(taskId, delta) {
      const worker = state.activeWorkers.get(taskId);
      if (!worker) return;
      worker.logs = (worker.logs || '') + delta;

      const pre = document.getElementById('terminal-' + taskId);
      if (pre) {
        const isScrolledToBottom = pre.scrollHeight - pre.clientHeight <= pre.scrollTop + 40;
        pre.textContent = worker.logs;
        if (isScrolledToBottom) {
          pre.scrollTop = pre.scrollHeight;
        }
      }
    }

    function copyTerminalText(taskId) {
      const worker = state.activeWorkers.get(taskId);
      if (worker && worker.logs) {
        navigator.clipboard.writeText(worker.logs).then(() => {
          showToast('Terminal output copied to clipboard', 'success');
        });
      }
    }

    // Abort Worker
    async function abortWorker(taskId) {
      if (!confirm('Are you sure you want to abort worker ' + taskId + '?')) return;
      try {
        const res = await fetch('/api/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId })
        });
        const data = await res.json();
        if (data.cancelled) {
          showToast('Worker ' + taskId + ' aborted successfully', 'warn');
        } else {
          showToast('Worker ' + taskId + ' was not active or could not be cancelled', 'info');
        }
      } catch (err) {
        showToast('Failed to abort worker: ' + err.message, 'error');
      }
    }

    // Render History Table
    function renderHistory() {
      const tbody = document.getElementById('history-table-body');
      if (!tbody) return;

      if (!state.history || state.history.length === 0) {
        tbody.innerHTML = \`<tr id="empty-history-row"><td colspan="6" class="py-6 text-center text-slate-500 italic">No tasks executed yet in this session.</td></tr>\`;
        return;
      }

      tbody.innerHTML = state.history.slice(0, 50).map(item => {
        const statusColors = {
          SUCCESS: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/50',
          FAILED: 'bg-rose-950/80 text-rose-300 border-rose-700/50',
          TIMED_OUT: 'bg-amber-950/80 text-amber-300 border-amber-700/50',
          CANCELLED: 'bg-slate-800 text-slate-300 border-slate-600/50',
        };
        const statusPill = \`<span class="px-2 py-0.5 rounded text-[10px] font-bold border \${statusColors[item.status] || 'bg-slate-800 text-slate-300'}>\${escapeHtml(item.status)}</span>\`;
        const filesCount = Array.isArray(item.filesChanged) ? item.filesChanged.length : (item.filesCount || 0);

        return \`
          <tr class="hover:bg-obsidian-hover/40 transition-colors">
            <td class="py-3 px-4">\${statusPill}</td>
            <td class="py-3 px-4 font-mono text-[11px] max-w-xs truncate" title="\${escapeHtml(item.task)}">\${escapeHtml(item.task || item.taskId)}</td>
            <td class="py-3 px-4 font-mono text-[11px] text-slate-400">\${escapeHtml(item.model || 'default')}</td>
            <td class="py-3 px-4 font-mono">\${formatDuration(Math.round((item.durationMs || 0) / 1000))}</td>
            <td class="py-3 px-4 font-mono text-indigo-300">\${filesCount} file\${filesCount === 1 ? '' : 's'}</td>
            <td class="py-3 px-4 text-right text-slate-500 text-[11px] font-mono">\${new Date(item.timestamp || Date.now()).toLocaleTimeString()}</td>
          </tr>\`;
      }).join('');
    }

    function recordHistoryItem(item) {
      state.history.unshift(item);
      if (state.history.length > 100) state.history.pop();
      try {
        localStorage.setItem('pi_agent_history', JSON.stringify(state.history));
      } catch {}
      renderHistory();
    }

    function clearHistory() {
      state.history = [];
      try {
        localStorage.removeItem('pi_agent_history');
      } catch {}
      renderHistory();
      showToast('Task history cleared', 'info');
    }

    // Tab 2: Provider Configuration
    async function fetchConfig() {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        state.config = data;

        const defaultPill = document.getElementById('metric-default-model');
        if (defaultPill) {
          defaultPill.textContent = (data.defaultProvider || '') + ' / ' + (data.defaultModel || 'none');
        }
        const providersMetric = document.getElementById('metric-providers');
        if (providersMetric && data.providers) {
          providersMetric.textContent = data.providers.length;
        }

        renderProviders();
      } catch (err) {
        showToast('Failed to load configuration: ' + err.message, 'error');
      }
    }

    function renderProviders() {
      const container = document.getElementById('providers-grid');
      if (!container) return;

      if (!state.config || !state.config.providers || state.config.providers.length === 0) {
        container.innerHTML = \`<div class="p-8 text-center text-slate-500 col-span-full">No providers configured in models.json.</div>\`;
        return;
      }

      const { providers, defaultProvider, defaultModel } = state.config;

      container.innerHTML = providers.map(p => {
        const isDefault = p.id === defaultProvider;
        const models = Array.isArray(p.models) ? p.models : [];
        const hasKey = !!p.apiKey;

        return \`
          <div class="bg-obsidian-card border \${isDefault ? 'border-indigo-500/70 shadow-indigo-500/10 shadow-lg' : 'border-obsidian-border'} rounded-2xl p-5 flex flex-col justify-between transition-all">
            <div>
              <!-- Header -->
              <div class="flex items-start justify-between gap-2 mb-3">
                <div>
                  <div class="flex items-center gap-2">
                    <h3 class="font-bold text-sm text-white">\${escapeHtml(p.name || p.id)}</h3>
                    \${isDefault ? '<span class="text-[10px] font-bold uppercase bg-indigo-600 text-white px-2 py-0.5 rounded-full">DEFAULT</span>' : ''}
                  </div>
                  <span class="font-mono text-[11px] text-slate-400">\${escapeHtml(p.id)}</span>
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] font-mono \${hasKey ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/50' : 'bg-slate-800 text-slate-400'}">
                  \${hasKey ? '● Key Configured' : '○ No Key'}
                </span>
              </div>

              <!-- Base URL -->
              <div class="mb-3 bg-obsidian p-2 rounded-lg border border-obsidian-border">
                <span class="text-[10px] text-slate-500 block uppercase font-mono">Base URL</span>
                <span class="font-mono text-xs text-slate-300 break-all">\${escapeHtml(p.baseUrl || 'None')}</span>
              </div>

              <!-- Models Selector -->
              <div class="mb-4">
                <label class="text-[10px] text-slate-500 block uppercase font-mono mb-1">Available Models (\${models.length})</label>
                <select id="select-model-\${p.id}" class="w-full bg-obsidian border border-obsidian-border rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500">
                  \${models.map(m => \`
                    <option value="\${escapeHtml(m.id)}" \${(p.defaultModel === m.id || defaultModel === m.id) ? 'selected' : ''}>
                      \${escapeHtml(m.id)} \${m.name ? '(' + escapeHtml(m.name) + ')' : ''}
                    </option>
                  \`).join('')}
                </select>
              </div>
            </div>

            <!-- Action Buttons -->
            <div class="pt-3 border-t border-obsidian-border flex items-center justify-between gap-2">
              <button id="ping-btn-\${p.id}" onclick="testProviderPing('\${p.id}', '\${escapeHtml(p.baseUrl)}')" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-obsidian border border-obsidian-border text-slate-300 hover:text-white hover:bg-obsidian-hover transition-colors flex items-center gap-1.5">
                <span>📡</span> Test Ping
              </button>
              
              <button onclick="setDefaultModel('\${p.id}')" class="px-3 py-1.5 rounded-lg text-xs font-medium \${isDefault ? 'bg-slate-800 text-slate-400 cursor-default' : 'bg-indigo-600/80 hover:bg-indigo-500 text-white'} transition-colors">
                \${isDefault ? 'Current Default' : 'Set as Default'}
              </button>
            </div>
            <div id="ping-result-\${p.id}" class="mt-2 text-[11px] font-mono hidden"></div>
          </div>\`;
      }).join('');
    }

    async function testProviderPing(providerId, url) {
      const btn = document.getElementById('ping-btn-' + providerId);
      const resDiv = document.getElementById('ping-result-' + providerId);
      if (!btn || !resDiv) return;

      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span> Pinging...';
      resDiv.classList.remove('hidden');
      resDiv.innerHTML = '<span class="text-slate-400 animate-pulse">Testing endpoint reachability...</span>';

      try {
        const res = await fetch('/api/test-provider', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, timeoutMs: 3000 })
        });
        const data = await res.json();
        if (data.reachable) {
          resDiv.innerHTML = \`<span class="text-emerald-400">🟢 Reachable (\${data.latencyMs}ms)</span>\`;
        } else {
          resDiv.innerHTML = \`<span class="text-rose-400">❌ Failed: \${escapeHtml(data.error || 'Unreachable')} (\${data.latencyMs}ms)</span>\`;
        }
      } catch (err) {
        resDiv.innerHTML = \`<span class="text-rose-400">❌ Error: \${escapeHtml(err.message)}</span>\`;
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>📡</span> Test Ping';
      }
    }

    async function setDefaultModel(providerId) {
      const select = document.getElementById('select-model-' + providerId);
      const selectedModel = select ? select.value : '';
      if (!selectedModel) {
        showToast('Please select or specify a model ID', 'error');
        return;
      }

      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            defaultProvider: providerId,
            defaultModel: selectedModel,
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Default model set to ' + providerId + ' / ' + selectedModel, 'success');
          fetchConfig();
        } else {
          showToast('Failed to update config: ' + (data.error || 'Unknown error'), 'error');
        }
      } catch (err) {
        showToast('Error setting default model: ' + err.message, 'error');
      }
    }

    // Add Provider Modal Handling
    function openAddProviderModal() {
      document.getElementById('add-provider-modal').classList.remove('hidden');
    }
    function closeAddProviderModal() {
      document.getElementById('add-provider-modal').classList.add('hidden');
    }

    async function handleAddProvider(e) {
      e.preventDefault();
      const id = document.getElementById('input-provider-id').value.trim();
      const name = document.getElementById('input-provider-name').value.trim();
      const baseUrl = document.getElementById('input-provider-url').value.trim();
      const defaultModel = document.getElementById('input-provider-model').value.trim();
      const apiKey = document.getElementById('input-provider-key').value.trim();

      if (!id || !baseUrl || !defaultModel) {
        showToast('Please fill in all required fields', 'error');
        return;
      }

      const providerConfig = {
        name: name || id,
        baseUrl,
        defaultModel,
        models: [{ id: defaultModel, name: defaultModel }],
        ...(apiKey ? { apiKey } : {})
      };

      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerId: id,
            providerConfig,
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Provider ' + id + ' added successfully', 'success');
          closeAddProviderModal();
          document.getElementById('add-provider-form').reset();
          fetchConfig();
        } else {
          showToast('Failed to save provider: ' + (data.error || 'Error'), 'error');
        }
      } catch (err) {
        showToast('Error saving provider: ' + err.message, 'error');
      }
    }

    // Tab 3: Doctor Diagnostics
    async function runDoctorCheck() {
      const btn = document.getElementById('run-doctor-btn');
      const statusIcon = document.getElementById('doctor-status-icon');
      const statusText = document.getElementById('doctor-status-text');
      const timestamp = document.getElementById('doctor-timestamp');
      const tbody = document.getElementById('doctor-providers-tbody');

      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳</span> Diagnosing...';
      }
      if (statusText) statusText.textContent = 'Running diagnostics...';

      try {
        // Attempt GET /api/doctor first, fallback to /api/status if not available
        let res = await fetch('/api/doctor');
        let report;
        if (res.ok) {
          report = await res.json();
        } else {
          const statusRes = await fetch('/api/status');
          const statusData = await statusRes.json();
          report = {
            status: statusData.piBinary?.installed ? 'HEALTHY' : 'DEGRADED',
            piBinary: statusData.piBinary,
            providers: []
          };
        }

        // Render Summary Banner
        if (statusText && statusIcon) {
          statusText.textContent = report.status || 'HEALTHY';
          if (report.status === 'HEALTHY') {
            statusIcon.className = 'w-10 h-10 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-700/50 flex items-center justify-center text-lg';
            statusIcon.textContent = '🟢';
            statusText.className = 'text-base font-bold text-emerald-400';
          } else if (report.status === 'DEGRADED') {
            statusIcon.className = 'w-10 h-10 rounded-full bg-amber-950 text-amber-400 border border-amber-700/50 flex items-center justify-center text-lg';
            statusIcon.textContent = '🟡';
            statusText.className = 'text-base font-bold text-amber-400';
          } else {
            statusIcon.className = 'w-10 h-10 rounded-full bg-rose-950 text-rose-400 border border-rose-700/50 flex items-center justify-center text-lg';
            statusIcon.textContent = '🔴';
            statusText.className = 'text-base font-bold text-rose-400';
          }
        }
        if (timestamp) timestamp.textContent = 'Last checked: ' + new Date().toLocaleTimeString();

        // Render Binary Details
        const binInstalled = document.getElementById('doc-bin-installed');
        const binPath = document.getElementById('doc-bin-path');
        const binVersion = document.getElementById('doc-bin-version');
        if (binInstalled) {
          const inst = report.piBinary?.installed;
          binInstalled.textContent = inst ? 'YES (Installed)' : 'NO (Missing)';
          binInstalled.className = inst ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold';
        }
        if (binPath) {
          binPath.textContent = report.piBinary?.path || 'Not located in PATH';
          binPath.title = report.piBinary?.path || '';
        }
        if (binVersion) {
          binVersion.textContent = report.piBinary?.version || 'N/A';
        }

        // Render Providers Table
        if (tbody) {
          const provs = report.providers || [];
          if (provs.length === 0) {
            tbody.innerHTML = \`<tr><td colspan="6" class="py-4 text-center text-slate-500 italic">No providers evaluated.</td></tr>\`;
          } else {
            tbody.innerHTML = provs.map(p => \`
              <tr class="hover:bg-obsidian-hover/40 transition-colors">
                <td class="py-3 px-4 font-bold text-white">\${escapeHtml(p.name || p.id)}</td>
                <td class="py-3 px-4 font-mono text-[11px] text-slate-400 break-all">\${escapeHtml(p.baseUrl || '')}</td>
                <td class="py-3 px-4 font-mono text-[11px] text-indigo-300">\${escapeHtml(p.model || '—')}</td>
                <td class="py-3 px-4">
                  \${p.reachable 
                    ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">CONNECTED</span>' 
                    : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800">FAILED</span>'}
                </td>
                <td class="py-3 px-4 font-mono">\${typeof p.latencyMs === 'number' ? p.latencyMs + 'ms' : '—'}</td>
                <td class="py-3 px-4 text-right font-mono text-slate-400 text-[11px]">\${escapeHtml(p.error || 'OK')}</td>
              </tr>
            \`).join('');
          }
        }

        showToast('Diagnostics complete: ' + (report.status || 'HEALTHY'), report.status === 'HEALTHY' ? 'success' : 'warn');
      } catch (err) {
        showToast('Doctor check error: ' + err.message, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<span>🩺</span> Run Doctor Check';
        }
      }
    }

    // SSE Connection to /api/events
    function connectEvents() {
      const portLabel = document.getElementById('port-label');
      const portMobile = document.getElementById('port-label-mobile');
      const connPill = document.getElementById('conn-pill');
      const connPillMobile = document.getElementById('conn-pill-mobile');

      // Update port from window.location
      const port = window.location.port || '7081';
      if (portLabel) portLabel.textContent = 'Port ' + port;
      if (portMobile) portMobile.textContent = 'Port ' + port;

      const evtSource = new EventSource('/api/events');

      evtSource.onopen = () => {
        state.connected = true;
        if (connPill) connPill.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-950/60 border border-emerald-800/50 text-emerald-300';
        if (connPillMobile) connPillMobile.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/60 border border-emerald-800/50 text-emerald-300';
      };

      evtSource.onerror = () => {
        state.connected = false;
        if (connPill) connPill.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-950/60 border border-rose-800/50 text-rose-300';
        if (connPillMobile) connPillMobile.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-950/60 border border-rose-800/50 text-rose-300';
      };

      evtSource.onmessage = (e) => {
        if (!e.data || e.data.startsWith(':')) return; // ignore keepalive
        try {
          const evt = JSON.parse(e.data);
          handleTaskEvent(evt);
        } catch {}
      };
    }

    function handleTaskEvent(evt) {
      if (!evt || !evt.type) return;

      switch (evt.type) {
        case 'init':
          if (Array.isArray(evt.activeTasks)) {
            state.activeWorkers.clear();
            evt.activeTasks.forEach(task => {
              state.activeWorkers.set(task.taskId, {
                taskId: task.taskId,
                cwd: task.cwd,
                task: task.task,
                runningSec: task.runningSec || 0,
                logs: '',
              });
            });
            renderActiveWorkers();
          }
          break;

        case 'task_started':
          state.activeWorkers.set(evt.taskId, {
            taskId: evt.taskId,
            cwd: evt.cwd,
            task: evt.task,
            model: evt.model,
            startTime: evt.startTime || Date.now(),
            runningSec: 0,
            logs: '',
          });
          renderActiveWorkers();
          showToast('⚡ Worker ' + evt.taskId + ' started', 'info');
          break;

        case 'log_delta':
          if (evt.taskId && evt.delta) {
            appendTerminalLog(evt.taskId, evt.delta);
          }
          break;

        case 'task_finished':
          const finishedWorker = state.activeWorkers.get(evt.taskId);
          state.activeWorkers.delete(evt.taskId);
          renderActiveWorkers();

          recordHistoryItem({
            taskId: evt.taskId,
            task: finishedWorker?.task || 'Autonomous coding task',
            model: finishedWorker?.model || 'FreeToken Qwen 35B',
            status: evt.status || 'SUCCESS',
            durationMs: evt.durationMs || 0,
            filesChanged: evt.filesChanged || [],
            timestamp: Date.now(),
          });

          showToast('Worker ' + evt.taskId + ' ' + (evt.status || 'finished'), evt.status === 'SUCCESS' ? 'success' : 'warn');
          break;

        case 'task_cancelled':
          const cancelledWorker = state.activeWorkers.get(evt.taskId);
          state.activeWorkers.delete(evt.taskId);
          renderActiveWorkers();

          recordHistoryItem({
            taskId: evt.taskId,
            task: cancelledWorker?.task || 'Cancelled autonomous task',
            model: cancelledWorker?.model || 'FreeToken Qwen 35B',
            status: 'CANCELLED',
            durationMs: (cancelledWorker?.runningSec || 0) * 1000,
            filesChanged: [],
            timestamp: Date.now(),
          });

          showToast('Worker ' + evt.taskId + ' cancelled', 'warn');
          break;
      }
    }

    // Initial Setup
    window.addEventListener('DOMContentLoaded', () => {
      renderHistory();
      fetchConfig();
      connectEvents();
    });
  </script>
</body>
</html>`;
}
