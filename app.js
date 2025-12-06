(() => {
  // ------------------------------------------------------------
  // CORE NAMESPACE
  // ------------------------------------------------------------
  const OL = {};
  window.OL = OL;

  // ------------------------------------------------------------
  // STORAGE
  // ------------------------------------------------------------
  OL.store = {
    get(key, defVal) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? defVal : JSON.parse(raw);
      } catch {
        return defVal;
      }
    },
    set(key, val) {
      try {
        localStorage.setItem(key, JSON.stringify(val));
      } catch {}
    },
  };

  // ------------------------------------------------------------
  // UTILS
  // ------------------------------------------------------------
  function fuzzyMatch(str, pattern) {
    str = str.toLowerCase();
    pattern = pattern.toLowerCase();

    // exact or substring match
    if (str.includes(pattern)) return true;

    // fuzzy character match
    let j = 0;
    for (let i = 0; i < str.length && j < pattern.length; i++) {
      if (str[i] === pattern[j]) j++;
    }
    return j === pattern.length;
  }

  OL.utils = {
    uid() {
      return "id_" + Math.random().toString(36).slice(2, 10);
    },
    esc(s) {
      return String(s ?? "")
        .replace(/&/g, "&")
        .replace(/</g, "<")
        .replace(/>/g, ">")
        .replace(/"/g, """);
    },
    debounce(fn, ms) {
      let t;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(null, args), ms);
      };
    },
    getInitials(name) {
      if (!name) return "?";
      const parts = name.trim().split(/\s+/);
      if (!parts.length) return "?";
      if (parts.length === 1) return (parts[0][0] || "?").toUpperCase();
      return (parts[0][0] + parts[1][0]).toUpperCase();
    },
  };

  const { uid, esc, debounce } = OL.utils;

  // ------------------------------------------------------------
  // DEFAULT DATA
  // ------------------------------------------------------------
  const defaultApps = [
    {
      id: uid(),
      name: "Zapier",
      notes: "Automation glue",
      icon: null,
      functions: [],
      datapointMappings: [],
    },
    {
      id: uid(),
      name: "Google Workspace",
      notes:
        "Add individual connections for various Google Apps for workflow mapping purposes",
      icon: null,
      functions: [],
      datapointMappings: [],
    },
    {
      id: uid(),
      name: "Google Calendar",
      notes: "",
      icon: null,
      functions: [],
      datapointMappings: [],
    },
    {
      id: uid(),
      name: "Gmail",
      notes: "",
      icon: null,
      functions: [],
      datapointMappings: [],
    },
    {
      id: uid(),
      name: "Google Docs",
      notes: "",
      icon: null,
      functions: [],
      datapointMappings: [],
    },
    {
      id: uid(),
      name: "Google Sheets",
      notes: "",
      icon: null,
      functions: [],
      datapointMappings: [],
    },
    {
      id: uid(),
      name: "Google Drive",
      notes: "",
      icon: null,
      functions: [],
      datapointMappings: [],
    },
    {
      id: uid(),
      name: "Calendly",
      notes: "Scheduling platform",
      icon: null,
      functions: [],
      datapointMappings: [],
    },
    {
      id: uid(),
      name: "Zoom",
      notes: "",
      icon: null,
      functions: [],
      datapointMappings: [],
    },
    {
      id: uid(),
      name: "Wealthbox",
      notes: "CRM for advisors",
      icon: null,
      functions: [],
      datapointMappings: [],
    },
  ];

  const defaultFunctions = [
    "Automation",
    "Billing/Invoicing",
    "Bookkeeping",
    "Calendar",
    "CRM",
    "Custodian/TAMP",
    "Data Aggregation",
    "Data Gathering",
    "eSignature",
    "Email",
    "Email Marketing",
    "File Sharing/Storage",
    "Financial Planning",
    "Lead Generation",
    "Mind Mapping",
    "Notes Storage",
    "Office Suite",
    "Password Manager",
    "Phone/Text",
    "Pipeline Management",
    "Project Management",
    "Risk Tolerance",
    "Scheduler",
    "Task Management",
    "Tax Planning",
    "Tax Prep",
    "Time Tracking",
    "Transcription",
    "Video Conferencing",
    "Video Recording",
    "Website",
  ].map((name) => ({
    id: uid(),
    name,
    notes: "",
    icon: null,
  }));

  const defaultIntegrations = [
    {
      id: uid(),
      appA: defaultApps[0].id,
      appB: defaultApps[1].id,
      type: "zapier",
      direction: "AtoB",
      capabilities: [],
      countTriggersDirect: 0,
      countTriggersZapier: 0,
      countTriggersBoth: 0,
      countSearchesDirect: 0,
      countSearchesZapier: 0,
      countSearchesBoth: 0,
      countActionsDirect: 0,
      countActionsZapier: 0,
      countActionsBoth: 0,
    },
  ];

  const defaultDatapoints = [
    {
      id: uid(),
      name: "Client Email",
      description: "Primary client contact email address",
    },
    {
      id: uid(),
      name: "Client Name",
      description: "Full concatenated name of client",
    },
    {
      id: uid(),
      name: "Household ID",
      description: "Unique household entity identifier",
    },
  ];

  const defaultResources = [
    {
      id: uid(),
      name: "New Client Onboarding Workflow",
      references: {
        apps: [defaultApps[1].id],
        functions: [defaultFunctions[0].id, defaultFunctions[5].id],
      },
    },
  ];

  const defaultCapabilities = [];
  const defaultCanonicalCapabilities = [];

  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------
  OL.state = {
    apps: OL.store.get("apps", defaultApps),
    functions: OL.store.get("functions", defaultFunctions),
    integrations: OL.store.get("integrations", defaultIntegrations),
    resources: OL.store.get("resources", defaultResources),
    datapoints: OL.store.get("datapoints", defaultDatapoints),
    capabilities: OL.store.get("capabilities", defaultCapabilities),
    canonicalCapabilities: OL.store.get(
      "canonicalCapabilities",
      defaultCanonicalCapabilities,
    ),
  };

  // Seed canonical library from existing capabilities if empty (legacy)
  (function seedCanonicalCapsFromCapabilities() {
    const st = OL.state;
    if (!Array.isArray(st.canonicalCapabilities)) st.canonicalCapabilities = [];

    if (!st.canonicalCapabilities.length && Array.isArray(st.capabilities)) {
      const seen = new Set();
      st.capabilities.forEach((cap) => {
        const key = (cap.canonical || "").trim();
        if (!key) return;
        const lower = key.toLowerCase();
        if (seen.has(lower)) return;
        seen.add(lower);
        st.canonicalCapabilities.push({
          id: uid(),
          key,
          type: cap.type || "trigger",
          notes: "",
          group: "",
        });
      });
    }
  })();

  const state = OL.state;
  let capViewMode = "by-app"; // "by-app" or "by-type"

  // ------------------------------------------------------------
  // PERSIST
  // ------------------------------------------------------------
  OL.persist = debounce(() => {
    OL.store.set("apps", state.apps);
    OL.store.set("functions", state.functions);
    OL.store.set("integrations", state.integrations);
    OL.store.set("resources", state.resources);
    OL.store.set("datapoints", state.datapoints);
    OL.store.set("capabilities", state.capabilities);
    OL.store.set("canonicalCapabilities", state.canonicalCapabilities);
  }, 200);

  // ------------------------------------------------------------
  // ICON RENDERER
  // ------------------------------------------------------------
  OL.iconHTML = function (obj) {
    const icon = obj.icon;
    if (icon && icon.type === "emoji") {
      return `<div class="icon-emoji">${esc(icon.value)}</div>`;
    }
    if (icon && icon.type === "img") {
      return `<img src="${esc(icon.url)}" class="icon-img">`;
    }
    const letters = OL.utils.getInitials(obj.name || "");
    return `<div class="icon-fallback">${esc(letters)}</div>`;
  };

  // ------------------------------------------------------------
  // HELPERS
  // ------------------------------------------------------------
  function findAppById(id) {
    return state.apps.find((a) => a.id === id) || null;
  }

  function findFunctionById(id) {
    return state.functions.find((f) => f.id === id) || null;
  }

  function functionAssignments(fnId) {
    const out = [];
    state.apps.forEach((app) => {
      (app.functions || []).forEach((fref) => {
        if (fref.fnId === fnId) {
          out.push({ app, status: fref.status || "available" });
        }
      });
    });
    return out;
  }
  OL.functionAssignments = functionAssignments;

  function getResourcesForApp(appId) {
    const out = [];
    (state.resources || []).forEach((r) => {
      if (r.references?.apps?.includes(appId)) out.push(r);
    });
    return out;
  }

  function normalizeStatus(s) {
    if (s === "primary" || s === "evaluating" || s === "available") return s;
    return "available";
  }

  function renderDirectionArrow(direction) {
    if (direction === "AtoB")
      return `<span class="flip-arrow"><span class="arrow">→</span></span>`;
    if (direction === "BtoA")
      return `<span class="flip-arrow"><span class="arrow">←</span></span>`;
    if (direction === "both")
      return `<span class="flip-arrow"><span class="arrow">↔</span></span>`;
    return `<span class="flip-arrow"><span class="arrow">↕</span></span>`;
  }

  // ------------------------------------------------------------
  // CANONICAL CAPABILITIES HELPERS
  // ------------------------------------------------------------
  function findCanonicalById(id) {
    return (state.canonicalCapabilities || []).find((c) => c.id === id) || null;
  }

  function findCanonicalByKey(key) {
    if (!key) return null;
    const k = key.trim().toLowerCase();
    return (
      (state.canonicalCapabilities || []).find(
        (c) => (c.key || "").trim().toLowerCase() === k,
      ) || null
    );
  }

  function canonicalLabelForCap(cap) {
    if (!cap) return "";
    if (cap.canonicalId) {
      const canon = findCanonicalById(cap.canonicalId);
      if (canon) return canon.key || "";
    }
    // legacy fallback
    return cap.canonical || cap.name || "";
  }

  function ensureCanonicalForCap(cap) {
    if (!cap) return;
    if (cap.canonicalId) return;

    const rawKey = (cap.canonical || cap.name || "").trim();
    if (!rawKey) return;

    let canon = findCanonicalByKey(rawKey);
    if (!canon) {
      canon = {
        id: uid(),
        key: rawKey,
        type: cap.type || "action",
        notes: "",
        group: "",
      };
      state.canonicalCapabilities = state.canonicalCapabilities || [];
      state.canonicalCapabilities.push(canon);
    }

    cap.canonicalId = canon.id;
  }

  function migrateCanonicalFromLegacy() {
    (state.capabilities || []).forEach((cap) => {
      ensureCanonicalForCap(cap);
    });
  }

  // ------------------------------------------------------------
  // GLOBAL UI REFRESH (does NOT rebuild layout)
  // ------------------------------------------------------------
  OL.refreshAllUI = function () {
    renderAppsGrid();
    renderFunctionsGrid();
    renderIntegrationsGrid();
    renderDatapointsGrid();
    renderCanonicalCapsGrid();
    renderCapabilitiesGrid();
  };

  // ------------------------------------------------------------
  // ZAPIER / CAPABILITY HELPERS
  // ------------------------------------------------------------
  function appHasZapierCapability(appId) {
    return state.capabilities.some(
      (c) =>
        c.appId === appId &&
        (c.integrationType === "zapier" || c.integrationType === "both"),
    );
  }

  function updateIntegrationTypeFromCapabilities(int) {
    const refs = int.capabilities || [];
    let hasDirect = false;
    let hasZapier = false;

    refs.forEach((ref) => {
      const cap = state.capabilities.find((c) => c.id === ref.capabilityId);
      if (!cap) return;
      const it = cap.integrationType || "zapier";
      if (it === "direct") hasDirect = true;
      else if (it === "zapier") hasZapier = true;
      else if (it === "both") {
        hasDirect = true;
        hasZapier = true;
      }
    });

    if (hasDirect && hasZapier) int.type = "both";
    else if (hasDirect) int.type = "direct";
    else if (hasZapier) int.type = "zapier";
  }

  function syncZapierIntegrationsFromCapabilities() {
    const zapAppIds = state.apps
      .filter((app) => appHasZapierCapability(app.id))
      .map((a) => a.id);

    for (let i = 0; i < zapAppIds.length; i++) {
      for (let j = i + 1; j < zapAppIds.length; j++) {
        const a = zapAppIds[i];
        const b = zapAppIds[j];

        let int = state.integrations.find(
          (i2) =>
            (i2.appA === a && i2.appB === b) ||
            (i2.appA === b && i2.appB === a),
        );

        if (!int) {
          int = {
            id: uid(),
            appA: a,
            appB: b,
            type: "zapier",
            direction: "AtoB",
            capabilities: [],
          };
          state.integrations.push(int);
        } else {
          if (int.type === "direct") int.type = "both";
          else if (!int.type) int.type = "zapier";
        }
      }
    }

    state.integrations.forEach(updateIntegrationTypeFromCapabilities);
  }

  // ------------------------------------------------------------
  // LAYOUT (built once)
  // ------------------------------------------------------------
  function buildLayout() {
    const root = document.getElementById("app-root");
    if (!root) return;

    root.innerHTML = `
      <div class="app">
        <aside class="sidebar">
            <nav class="menu" id="nav">
              <div class="group-title">Apps</div>
              <a href="#/apps" data-route>Apps</a>
              <a href="#/triggers-actions" data-route>Triggers & Actions Library</a>
              <a href="#/analyze" data-route>Analyze</a>

              <div class="divider"></div>
              <div class="group-title">Resources</div>
              <a href="#/resources/documents" data-route>Documents and PDFs</a>
              <a href="#/resources/email-templates" data-route>Email Templates</a>
              <a href="#/resources/forms" data-route>Forms</a>
              <a href="#/resources/scheduling" data-route>Scheduling</a>
              <a href="#/resources/zaps" data-route>Zaps</a>
              <a href="#/resources/email-campaigns" data-route>Email Campaigns</a>
              <a href="#/resources/workflows" data-route>Workflows</a>

              <div class="divider"></div>
              <div class="group-title">Settings</div>
              <a href="#/settings/team" data-route>Team</a>
              <a href="#/settings/segments" data-route>Segments</a>
              <a href="#/settings/datapoints" data-route>Datapoints</a>
              <a href="#/settings/canonical-capabilities" data-route>Canonical Capabilities</a>
              <a href="#/settings/folder-hierarchy" data-route>Folder Hierarchy</a>
              <a href="#/settings/naming-conventions" data-route>Naming Conventions</a>
            </nav>
          </aside>
          <main id="mainContent">
            <section class="section" id="section-apps">
              <div class="section-header">
                <h2>Applications</h2>
                <div class="spacer"></div>
                <div class="section-actions">
                  <button class="btn small" id="btnAddApp">+ Add Application</button>
                </div>
              </div>
              <div id="appsGrid" class="cards-grid"></div>
            </section>

            <section class="section" id="section-functions">
              <div class="section-header">
                <h2>Functions</h2>
                <div class="spacer"></div>
                <div class="section-actions">
                  <button class="btn small" id="btnAddFunction">+ Add Function</button>
                </div>
              </div>
              <div class="pill-key-row">
                <div class="pill-key">
                  <span class="pill fn status-primary">Primary</span>
                  <span class="pill fn status-evaluating">Evaluating</span>
                  <span class="pill fn status-available">Available</span>
                  <span class="pill-key-help">
                    Left-click a pill to cycle status; right-click to remove the mapping.
                  </span>
                </div>
              </div>
              <div id="functionsGrid" class="cards-grid"></div>
            </section>

            <section class="section" id="section-integrations">
              <div class="section-header">
                <h2>Integrations</h2>
                <div class="spacer"></div>
                <div class="section-actions">
                  <button class="btn small soft" id="btnAddIntegration">+ Add Integration</button>
                </div>
              </div>
              <div class="pill-key-row">
                <div class="pill-key">
                  <span class="pill integr" data-type="direct">Direct</span>
                  <span class="pill integr" data-type="zapier">Zapier</span>
                  <span class="pill integr" data-type="both">Both</span>
                  <span class="pill-key-help">
                    Left-click a pill to cycle directionality; right-click to cycle integration type.
                  </span>
                </div>
              </div>
              <div id="integrationsGrid" class="cards-grid"></div>
            </section>

            <section class="section" id="section-datapoints">
              <div class="section-header">
                <h2>Datapoints</h2>
                <div class="spacer"></div>
                <div class="section-actions">
                  <button class="btn small" id="btnAddDatapointGlobal">+ Add Datapoint</button>
                </div>
              </div>
              <div id="datapointsGrid" class="cards-grid"></div>
            </section>

            <section class="section" id="section-capabilities">
              <div class="section-header">
                <h2>Triggers / Searches / Actions Library</h2>
                <div class="spacer"></div>
                <div class="section-actions">
                  <button class="btn small" id="btnAddCapability">+ Add Item</button>
                </div>
              </div>
              <div class="cap-view-toggle">
                <button class="btn xsmall soft" data-capview="by-app">By App</button>
                <button class="btn xsmall soft" data-capview="by-type">By Type</button>
              </div>
              <div id="capabilitiesGrid" class="cards-grid"></div>
            </section>

            <section class="section" id="section-canonical-caps">
              <div class="section-header">
                <h2>Canonical Capabilities</h2>
                <div class="spacer"></div>
                <div class="section-actions">
                  <button class="btn small" id="btnAddCanonicalCap">+ Add Canonical Capability</button>
                </div>
              </div>
              <div id="canonicalCapsGrid" class="cards-grid"></div>
            </section>

          </main>
        </div>
      </div>
    `;

    wireTopButtons();
  }

  // ------------------------------------------------------------
  // APPS GRID
  // ------------------------------------------------------------
  function renderAppsGrid() {
    const grid = document.getElementById("appsGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const appsSorted = [...state.apps].sort((a, b) =>
      (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()),
    );

    appsSorted.forEach((app) => {
      grid.insertAdjacentHTML("beforeend", renderAppCard(app));
    });
  }

  function renderAppCard(app) {
    const fnPills = (app.functions || [])
      .slice()
      .sort((a, b) => {
        const order = { primary: 0, evaluating: 1, available: 2 };
        return (
          order[normalizeStatus(a.status)] - order[normalizeStatus(b.status)]
        );
      })
      .map((ref) => {
        const fn = findFunctionById(ref.fnId);
        if (!fn) return "";
        const status = normalizeStatus(ref.status);
        return `
          <span
            class="pill fn"
            data-status="${status}"
            data-fn-id="${fn.id}"
            oncontextmenu="OL.removeFunctionFromApp(event, '${app.id}', '${fn.id}')"
          >
            ${esc(fn.name)}
          </span>
        `;
      })
      .join("");

    const ints = state.integrations.filter((i) => {
      if (i.appA !== app.id && i.appB !== app.id) return false;
      const t = i.type || "direct";
      return t === "direct" || t === "both";
    });

    const intPills = ints.length
      ? ints
          .map((int) => {
            const otherId = int.appA === app.id ? int.appB : int.appA;
            const other = findAppById(otherId);
            const name = other ? other.name : "(unknown)";
            return `
              <span class="pill integr plain"
                data-int-id="${int.id}"
                oncontextmenu="OL.removeIntegration(event, '${int.id}')"
              >
                ${esc(name)}
              </span>
            `;
          })
          .join("")
      : `<span class="pill muted">None</span>`;

    return `
      <div class="card" data-app-id="${app.id}" onclick="OL.openAppModal('${app.id}')">
        <div class="card-header">
          <div class="card-header-left">
            <div class="card-icon">${OL.iconHTML(app)}</div>
            <div class="card-title">${esc(app.name || "")}</div>
          </div>
          <div
            class="card-close"
            onclick="event.stopPropagation(); OL.deleteApp('${app.id}')"
          >×</div>
        </div>
        <div class="card-body">
          <div class="card-section">
            <div class="card-section-title">Notes</div>
            <div class="card-section-content single-line-text ${
              !app.notes ? "muted" : ""
            }">
              ${esc(app.notes || "No notes")}
            </div>
          </div>

          <div class="card-section">
            <div class="card-section-title">Functions</div>
            <div class="card-section-content">
              <div class="pills-row">
                ${fnPills || '<span class="pill muted">No functions</span>'}
              </div>
            </div>
          </div>

          <div class="card-section">
            <div class="card-section-title">Direct Integrations</div>
            <div class="card-section-content">
              <div class="pills-row">
                ${intPills}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------
  // FUNCTIONS GRID
  // ------------------------------------------------------------
  function renderFunctionsGrid() {
    const grid = document.getElementById("functionsGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const fns = [...state.functions].sort((a, b) =>
      (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()),
    );

    fns.forEach((fn) => {
      grid.insertAdjacentHTML("beforeend", renderFunctionCard(fn));
    });
  }

  function renderFunctionCard(fn) {
    const links = OL.functionAssignments(fn.id);
    links.sort((a, b) => {
      const order = { primary: 0, evaluating: 1, available: 2 };
      return (
        order[normalizeStatus(a.status)] - order[normalizeStatus(b.status)]
      );
    });

    const appPills = links.length
      ? links
          .map((link) => {
            const status = normalizeStatus(link.status);
            return `
              <span
                class="pill fn status-${status}"
                data-app-id="${link.app.id}"
                onclick="OL.cycleFunctionStatus(event, '${link.app.id}', '${fn.id}')"
                oncontextmenu="OL.removeFunctionFromApp(event, '${link.app.id}', '${fn.id}')"
              >
                ${esc(link.app.name || "")}
              </span>
            `;
          })
          .join("")
      : `<span class="pill muted">No apps mapped</span>`;

    return `
      <div class="card" data-fn-id="${fn.id}" onclick="OL.openFunctionModal('${fn.id}')">
        <div class="card-header">
          <div class="card-header-left">
            <div class="card-icon">${OL.iconHTML(fn)}</div>
            <div class="card-title">${esc(fn.name || "")}</div>
          </div>
          <div
            class="card-close"
            onclick="event.stopPropagation(); OL.deleteFunction('${fn.id}')"
          >×</div>
        </div>
        <div class="card-body">
          <div class="card-section">
            <div class="card-section-title">Notes</div>
            <div class="card-section-content single-line-text ${
              !fn.notes ? "muted" : ""
            }">
              ${esc(fn.notes || "No notes")}
            </div>
          </div>
          <div class="card-section">
            <div class="card-section-title">Apps</div>
            <div class="card-section-content">
              <div class="pills-row">
                ${appPills}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------
  // INTEGRATIONS GRID
  // ------------------------------------------------------------
  function summarizeIntegrationCapabilities(int) {
    const caps = int.capabilities || [];
    const summary = {
      trigger: { direct: 0, zapier: 0, both: 0 },
      search: { direct: 0, zapier: 0, both: 0 },
      action: { direct: 0, zapier: 0, both: 0 },
    };

    caps.forEach((ref) => {
      const cap = state.capabilities.find((c) => c.id === ref.capabilityId);
      if (!cap) return;
      const type = cap.type || "action";
      let it = cap.integrationType || "zapier";
      if (!["direct", "zapier", "both"].includes(it)) it = "zapier";
      if (!summary[type]) return;
      summary[type][it]++;
    });

    return summary;
  }

  function renderIntegrationsGrid() {
    const grid = document.getElementById("integrationsGrid");
    if (!grid) return;
    grid.innerHTML = "";

    if (!state.integrations.length) {
      grid.innerHTML = `<div class="empty-hint">No integrations yet.</div>`;
      return;
    }

    function normalizePair(a, b) {
      return a < b ? [a, b] : [b, a];
    }

    const seen = new Set();
    const uniqueInts = [];

    state.integrations.forEach((int) => {
      const [a, b] = normalizePair(int.appA, int.appB);
      const key = `${a}|${b}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueInts.push(int);
      }
    });

    uniqueInts.forEach((int) => {
      const appA = findAppById(int.appA);
      const appB = findAppById(int.appB);
      const summary = summarizeIntegrationCapabilities(int);

      grid.insertAdjacentHTML(
        "beforeend",
        `
        <div class="card" data-int-id="${int.id}" onclick="OL.openIntegrationModal('${int.id}')">
          <div class="card-header">
            <div class="card-header-left">
              <span class="card-app-name">${esc(appA?.name || "")}</span>
              <div class="arrow-switch" data-int-id="${int.id}">
                <div class="arrow-layer arrow-top" title="Primary direction: A to B">⇨</div>
                <div class="arrow-layer arrow-bottom" title="Secondary direction: B to A">⇦</div>
              </div>
              <span class="card-app-name">${esc(appB?.name || "")}</span>
            </div>
            <div
              class="card-close"
              onclick="event.stopPropagation(); OL.removeIntegration(event, '${int.id}')"
            >×</div>
          </div>
          <div class="card-body">
            <div class="card-section">
              <div class="card-section-title">Triggers</div>
              <div class="pills-row">
                <div class="count-line">
                  <span class="dot-direct"></span><span>${summary.trigger.direct}</span>
                  <span class="dot-zapier"></span><span>${summary.trigger.zapier}</span>
                  <span class="dot-both"></span><span>${summary.trigger.both}</span>
                </div>
              </div>
            </div>

            <div class="card-section">
              <div class="card-section-title">Searches</div>
              <div class="pills-row">
                <div class="count-line">
                  <span class="dot-direct"></span><span>${summary.search.direct}</span>
                  <span class="dot-zapier"></span><span>${summary.search.zapier}</span>
                  <span class="dot-both"></span><span>${summary.search.both}</span>
                </div>
              </div>
            </div>

            <div class="card-section">
              <div class="card-section-title">Actions</div>
              <div class="pills-row">
                <div class="count-line">
                  <span class="dot-direct"></span><span>${summary.action.direct}</span>
                  <span class="dot-zapier"></span><span>${summary.action.zapier}</span>
                  <span class="dot-both"></span><span>${summary.action.both}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      `,
      );
    });

    grid.querySelectorAll(".arrow-switch").forEach((el) => {
      el.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const id = el.getAttribute("data-int-id");
        const int = state.integrations.find((i) => i.id === id);
        if (!int) return;

        const tmp = int.appA;
        int.appA = int.appB;
        int.appB = tmp;

        OL.persist();
        renderIntegrationsGrid();
      };
    });
  }

  // ------------------------------------------------------------
  // DATAPOINTS GRID (clean + hardened)
  // ------------------------------------------------------------
  function renderDatapointsGrid() {
    const grid = document.getElementById("datapointsGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const data = Array.isArray(state.datapoints) ? state.datapoints : [];
    if (!data.length) {
      grid.innerHTML = `<div class="empty-hint">No datapoints yet.</div>`;
      return;
    }

    // Safe normalization util
    const norm = (v) => (typeof v === "string" ? v : v ? String(v) : "");

    // Sort safely
    const sorted = [...data].sort((a, b) => {
      const aKey = norm(a.fieldName).toLowerCase();
      const bKey = norm(b.fieldName).toLowerCase();
      return aKey.localeCompare(bKey);
    });

    sorted.forEach((dp) => {
      const app = findAppById(dp.appId);
      const appName = norm(app?.name);
      const field = norm(dp.fieldName);

      const cardHtml = `
        <div class="card datapoint-card" data-dp-id="${dp.id}">
          <div class="card-header">
            <div class="card-header-left">
              <div class="card-icon">${app ? OL.iconHTML(app) : ""}</div>
              <div class="card-title">${field || "(Unnamed Field)"}</div>
            </div>
            <div class="card-close"
                onclick="event.stopPropagation(); OL.deleteDatapoint('${dp.id}')">×</div>
          </div>

          <div class="card-body">
            <div class="card-section">
              <div class="card-section-title">Application</div>
              <div class="card-section-content">
                ${appName || "(Unknown App)"}
              </div>
            </div>

            <div class="card-section">
              <div class="card-section-title">Inbound Mapping</div>
              <div class="card-section-content single-line-text">
                ${norm(dp.inbound) || "<span class='muted'>None</span>"}
              </div>
            </div>

            <div class="card-section">
              <div class="card-section-title">Outbound Mapping</div>
              <div class="card-section-content single-line-text">
                ${norm(dp.outbound) || "<span class='muted'>None</span>"}
              </div>
            </div>
          </div>
        </div>
      `;

      grid.insertAdjacentHTML("beforeend", cardHtml);
    });

    // Wire click → modal
    grid.querySelectorAll("[data-dp-id]").forEach((el) => {
      el.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = el.getAttribute("data-dp-id");
        if (id) OL.openDatapointModal(id);
      };
    });
  }

  // ------------------------------------------------------------
  // CANONICAL CAPABILITIES GRID
  // ------------------------------------------------------------
  function renderCanonicalCapsGrid() {
    const grid = document.getElementById("canonicalCapsGrid");
    if (!grid) return;

    const list = (state.canonicalCapabilities || [])
      .slice()
      .sort((a, b) =>
        (a.key || "").toLowerCase().localeCompare((b.key || "").toLowerCase())
      );

    if (!list.length) {
      grid.innerHTML = `<div class="empty-hint">No canonical capabilities yet.</div>`;
      return;
    }

    grid.innerHTML = "";
    list.forEach((canon) => {
      const label = canon.label || canon.key || "(Unnamed canonical capability)";
      const type = canon.type || "";
      const notes = canon.notes || "";

      // how many concrete capabilities use this canonical id?
      const usageCount = (state.capabilities || []).filter(
        (cap) => cap.canonicalId === canon.id
      ).length;

      grid.insertAdjacentHTML(
        "beforeend",
        `
        <div class="card" data-canon-id="${canon.id}" onclick="OL.openCanonicalCapModal('${canon.id}')">
          <div class="card-header">
            <div class="card-header-left">
              <div class="card-title">${esc(label)}</div>
            </div>
            <div
              class="card-close"
              onclick="event.stopPropagation(); OL.deleteCanonicalCapability('${canon.id}')"
            >×</div>
          </div>
          <div class="card-body">
            <div class="card-section">
              <div class="card-section-title">Key</div>
              <div class="card-section-content single-line-text">
                ${esc(canon.key || "")}
              </div>
            </div>
            <div class="card-section">
              <div class="card-section-title">Type</div>
              <div class="card-section-content single-line-text">
                ${esc(type)}
              </div>
            </div>
            <div class="card-section">
              <div class="card-section-title">Notes</div>
              <div class="card-section-content single-line-text ${notes ? "" : "muted"}">
                ${esc(notes || "No notes")}
              </div>
            </div>
            <div class="card-section">
              <div class="card-section-title">Used By</div>
              <div class="card-section-content single-line-text">
                ${usageCount} capabilities
              </div>
            </div>
          </div>
        </div>
      `
      );
    });
  }

  // show all capabilities that reference this canonical
  function renderCanonicalUsageTable(canon) {
    const rows = (state.capabilities || []).filter(
      (cap) => cap.canonicalId === canon.id
    );

    if (!rows.length) {
      return `<div class="empty-hint">No capabilities currently linked.</div>`;
    }

    return `
      <div class="dp-table">
        <div class="dp-table-header">
          <span>Capability</span>
          <span>App</span>
          <span>Type</span>
          <span>Integration</span>
        </div>
        ${rows
          .map((cap) => {
            const app = findAppById(cap.appId);
            return `
            <div class="dp-table-row">
              <span class="dp-link-cap" data-cap-id="${cap.id}">${esc(cap.name || canonicalLabelForCap(cap) || "(unnamed)")}</span>
              <span class="dp-link-app" data-app-id="${app?.id || ""}">${esc(
                app?.name || ""
              )}</span>
              <span>${esc(cap.type || "")}</span>
              <span>${esc(cap.integrationType || "")}</span>
            </div>
          `;
          })
          .join("")}
      </div>
    `;
  }

  OL.openCanonicalCapModal = function (canonId) {
    const canon = (state.canonicalCapabilities || []).find((c) => c.id === canonId);
    if (!canon) return;

    openModal(`
      <div class="modal-head">
        <div class="modal-title-text" id="canonLabel" contenteditable="true">
          ${esc(canon.label || canon.key || "Canonical Capability")}
        </div>
        <div class="spacer"></div>
        <button class="btn small soft" onclick="OL.closeModal()">Close</button>
      </div>
      <div class="modal-body">
        <label class="modal-section-label">Key (unique identifier)</label>
        <input id="canonKey" class="modal-textarea" style="min-height:auto;height:auto;"
          value="${esc(canon.key || "")}">

        <label class="modal-section-label">Type</label>
        <select id="canonType" class="modal-textarea" style="min-height:auto;height:auto;">
          <option value="trigger" ${(canon.type || "trigger") === "trigger" ? "selected" : ""}>Trigger</option>
          <option value="search" ${(canon.type || "") === "search" ? "selected" : ""}>Search</option>
          <option value="action" ${(canon.type || "") === "action" ? "selected" : ""}>Action</option>
        </select>

        <label class="modal-section-label">Notes</label>
        <textarea id="canonNotes" class="modal-textarea">${esc(canon.notes || "")}</textarea>

        <label class="modal-section-label">Used by capabilities</label>
        <div id="canonUsageTable">
          ${renderCanonicalUsageTable(canon)}
        </div>
      </div>
    `);

    const layer = getModalLayer();
    if (!layer) return;

    const labelEl = layer.querySelector("#canonLabel");
    const keyEl = layer.querySelector("#canonKey");
    const typeEl = layer.querySelector("#canonType");
    const notesEl = layer.querySelector("#canonNotes");

    if (labelEl) {
      labelEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          labelEl.blur();
        }
      });
      labelEl.addEventListener("blur", () => {
        canon.label = labelEl.textContent.trim() || canon.key || "";
        OL.persist();
        renderCanonicalCapsGrid();
        renderCapabilitiesGrid();
      });
    }

    if (keyEl) {
      keyEl.addEventListener(
        "input",
        debounce(() => {
          const newKey = keyEl.value.trim();
          if (!newKey) return;
          canon.key = newKey;
          OL.persist();
          renderCanonicalCapsGrid();
          renderCapabilitiesGrid();
        }, 200)
      );
    }

    if (typeEl) {
      typeEl.onchange = () => {
        canon.type = typeEl.value;
        OL.persist();
        renderCanonicalCapsGrid();
        renderCapabilitiesGrid();
      };
    }

    if (notesEl) {
      notesEl.addEventListener(
        "input",
        debounce(() => {
          canon.notes = notesEl.value;
          OL.persist();
          renderCanonicalCapsGrid();
        }, 200)
      );
    }

    // usage links → open capability or app modal
    layer.querySelectorAll(".dp-link-cap").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const id = el.getAttribute("data-cap-id");
        if (id) {
          OL.closeModal();
          OL.openCapabilityModal(id);
        }
      };
    });

    layer.querySelectorAll(".dp-link-app").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const id = el.getAttribute("data-app-id");
        if (id) {
          OL.closeModal();
          OL.openAppModal(id);
        }
      };
    });
  };

  OL.deleteCanonicalCapability = function (canonId) {
    const canon = (state.canonicalCapabilities || []).find((c) => c.id === canonId);
    if (!canon) return;

    const inUse = (state.capabilities || []).some((cap) => cap.canonicalId === canonId);
    const msg = inUse
      ? `This canonical capability is used by one or more capabilities. Delete anyway? The capabilities will keep their current labels but lose the canonical link.`
      : `Delete this canonical capability?`;

    if (!confirm(msg)) return;

    // strip canonical link from concrete capabilities
    (state.capabilities || []).forEach((cap) => {
      if (cap.canonicalId === canonId) {
        cap.canonicalId = null;
        // leave cap.canonical / cap.name alone
      }
    });

    state.canonicalCapabilities = (state.canonicalCapabilities || []).filter(
      (c) => c.id !== canonId
    );

    OL.persist();
    renderCanonicalCapsGrid();
    renderCapabilitiesGrid();
  };


  // ------------------------------------------------------------
  // CAPABILITIES GRID (Triggers / Searches / Actions)
  // ------------------------------------------------------------
  function renderCapabilitiesGrid() {
    const grid = document.getElementById("capabilitiesGrid");
    if (!grid) return;
    grid.innerHTML = "";

    if (!state.capabilities.length) {
      grid.innerHTML = `<div class="empty-hint">No capabilities yet.</div>`;
      return;
    }

    if (capViewMode === "by-type") {
      renderCapabilitiesByType(grid);
    } else {
      renderCapabilitiesByApp(grid);
    }

    wireCapabilityClicks(grid);
  }

  // ------------------------------------------------------------
  // VIEW: BY APP
  // ------------------------------------------------------------
  function renderCapabilitiesByApp(grid) {
    const appCaps = state.apps
      .map((app) => ({
        app,
        caps: state.capabilities.filter((c) => c.appId === app.id),
      }))
      .filter((x) => x.caps.length);

    if (!appCaps.length) {
      grid.innerHTML = `<div class="empty-hint">No capabilities yet.</div>`;
      return;
    }

    appCaps
      .sort((a, b) =>
        (a.app.name || "")
          .toLowerCase()
          .localeCompare((b.app.name || "").toLowerCase()),
      )
      .forEach(({ app, caps }) => {
        const triggers = caps.filter((c) => c.type === "trigger");
        const searches = caps.filter((c) => c.type === "search");
        const actions = caps.filter((c) => c.type === "action");

        const cardHtml = `
          <div class="card cap-app-card" data-app-id="${app.id}">
            <div class="card-header">
              <div class="card-header-left">
                <div class="card-icon">${OL.iconHTML(app)}</div>
                <div class="card-title cap-app-title"
                    data-open-app-id="${app.id}">
                    ${esc(app.name || "")}
                </div>
              </div>
            </div>
            <div class="card-body">
              ${renderCapListColumn("Triggers", triggers)}
              ${renderCapListColumn("Searches", searches)}
              ${renderCapListColumn("Actions", actions)}
            </div>
          </div>
        `;
        grid.insertAdjacentHTML("beforeend", cardHtml);
      });
  }

  function renderCapListColumn(title, items) {
    if (!items.length) return "";
    return `
      <div class="card-section">
        <div class="card-section-title">${title}</div>
        <div class="card-section-content">
          ${items
            .map((cap) => {
              const it = cap.integrationType || "zapier";
              const label = canonicalLabelForCap(cap) || "(Unnamed capability)";
              return `
                <div class="cap-row" data-cap-id="${cap.id}">
                  <span class="dot-${esc(it)}"></span>
                  <span class="cap-name-link">${esc(label)}</span>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------
  // VIEW: BY TYPE
  // ------------------------------------------------------------
  function renderCapabilitiesByType(grid) {
    const groupsByType = {
      trigger: new Map(),
      search: new Map(),
      action: new Map(),
    };

    state.capabilities.forEach((cap) => {
      const type = cap.type || "action";
      const map = groupsByType[type];
      if (!map) return;

      const canon = cap.canonicalId ? findCanonicalById(cap.canonicalId) : null;
      const keyBase = (canon?.key || cap.canonical || cap.name || "").trim();
      const key = keyBase.toLowerCase() || `cap:${cap.id}`;

      let group = map.get(key);
      if (!group) {
        group = {
          canonical:
            canon?.key || cap.canonical || cap.name || "(Unnamed capability)",
          integrationTypes: new Set(),
          caps: [],
        };
        map.set(key, group);
      }

      group.caps.push(cap);
      group.integrationTypes.add(cap.integrationType || "zapier");
    });

    const typeOrder = ["trigger", "search", "action"];
    const labels = {
      trigger: "Triggers",
      search: "Searches",
      action: "Actions",
    };

    typeOrder.forEach((type) => {
      const map = groupsByType[type];
      if (!map || !map.size) return;

      grid.insertAdjacentHTML(
        "beforeend",
        `<h3 class="cap-type-heading">${labels[type]}</h3>`,
      );

      const cards = Array.from(map.values())
        .sort((a, b) =>
          a.canonical.toLowerCase().localeCompare(b.canonical.toLowerCase()),
        )
        .map((group) => {
          const apps = group.caps
            .map((cap) => findAppById(cap.appId))
            .filter(Boolean)
            .map((app) => app.name);
          const uniqueApps = [...new Set(apps)];

          const types = group.integrationTypes;
          let integLabel = "zapier";
          if (types.has("both")) integLabel = "both";
          else if (types.has("direct") && types.has("zapier"))
            integLabel = "both";
          else if (types.has("direct")) integLabel = "direct";

          return `
            <div class="card cap-type-card" data-cap-id="${group.caps[0].id}">
              <div class="card-header">
                <div class="card-title">${esc(group.canonical)}</div>
              </div>
              <div class="card-body">
                <div class="card-section">
                  <div class="card-section-title">Apps</div>
                  <div class="card-section-content">
                    ${
                      uniqueApps.length
                        ? uniqueApps
                            .map(
                              (name) =>
                                `<span class="pill integr">${esc(name)}</span>`,
                            )
                            .join("")
                        : '<span class="pill muted">No apps linked</span>'
                    }
                  </div>
                </div>
                <div class="card-section">
                  <div class="card-section-title">Integration Type</div>
                  <div class="card-section-content">
                    <span class="pill integr">${esc(integLabel)}</span>
                  </div>
                </div>
              </div>
            </div>
          `;
        })
        .join("");

      grid.insertAdjacentHTML(
        "beforeend",
        `<div class="cards-grid">${cards}</div>`,
      );
    });
  }

  // ------------------------------------------------------------
  // CLICK HANDLING — universal, applied once
  // ------------------------------------------------------------
  function wireCapabilityClicks(grid) {
    grid.querySelectorAll("[data-cap-id]").forEach((el) => {
      el.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = el.getAttribute("data-cap-id");
        if (id) OL.openCapabilityModal(id);
      };
    });

    grid.querySelectorAll("[data-open-app-id]").forEach((el) => {
      el.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const appId = el.getAttribute("data-open-app-id");
        if (appId) OL.openAppModal(appId);
      };
    });
  }

  // ------------------------------------------------------------
  // TOP BUTTONS
  // ------------------------------------------------------------
  function wireTopButtons() {
    const btnAddApp = document.getElementById("btnAddApp");
    const btnAddFn = document.getElementById("btnAddFunction");
    const btnAddInt = document.getElementById("btnAddIntegration");
    const btnAddDpGlobal = document.getElementById("btnAddDatapointGlobal");
    const btnAddCapability = document.getElementById("btnAddCapability");
    const btnAddCanonicalCap = document.getElementById("btnAddCanonicalCap");

    if (btnAddApp) {
      btnAddApp.onclick = () => {
        const app = {
          id: uid(),
          name: "New App",
          notes: "",
          icon: null,
          functions: [],
          datapointMappings: [],
        };
        state.apps.push(app);
        OL.persist();
        OL.refreshAllUI();
        OL.openAppModal(app.id);
      };
    }

    if (btnAddFn) {
      btnAddFn.onclick = () => {
        const fn = {
          id: uid(),
          name: "New Function",
          notes: "",
          icon: null,
        };
        state.functions.push(fn);
        OL.persist();
        OL.refreshAllUI();
        OL.openFunctionModal(fn.id);
      };
    }

    if (btnAddInt) {
      btnAddInt.onclick = () => {
        alert(
          'To add an integration, open an App card and use "+ Add Integration" in the modal.',
        );
      };
    }

    if (btnAddDpGlobal) {
      btnAddDpGlobal.onclick = () => {
        const dp = {
          id: uid(),
          name: "New Datapoint",
          description: "",
        };
        state.datapoints.push(dp);
        OL.persist();
        renderDatapointsGrid();
      };
    }

    if (btnAddCapability) {
      btnAddCapability.onclick = () => {
        const cap = {
          id: uid(),
          name: "New Capability",
          appId: state.apps[0]?.id || null,
          type: "trigger",
          integrationType: "zapier",
          canonical: "",
          notes: "",
          source: "manual",
        };
        state.capabilities.push(cap);
        syncZapierIntegrationsFromCapabilities();
        OL.persist();
        OL.refreshAllUI();
        OL.openCapabilityModal(cap.id);
      };
    }

    if (btnAddCanonicalCap) {
      btnAddCanonicalCap.onclick = () => {
        const canon = {
          id: uid(),
          key: "new_canonical_capability",
          label: "New canonical capability",
          type: "trigger",
          notes: "",
        };
        state.canonicalCapabilities = state.canonicalCapabilities || [];
        state.canonicalCapabilities.push(canon);
        OL.persist();
        renderCanonicalCapsGrid();
        OL.openCanonicalCapModal(canon.id);
      };
    }

  }

  function wireCapabilityViewToggle() {
    const section = document.getElementById("section-capabilities");
    if (!section) return;

    section.querySelectorAll("[data-capview]").forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        const mode = btn.getAttribute("data-capview");
        if (!mode) return;
        capViewMode = mode;
        renderCapabilitiesGrid();
      };
    });
  }

  // ------------------------------------------------------------
  // MODAL SYSTEM
  // ------------------------------------------------------------
  let modalLayer = null;
  let activeOnClose = null;

  function getModalLayer() {
    if (!modalLayer) {
      modalLayer = document.getElementById("modal-layer");
    }
    return modalLayer;
  }

  function openModal(contentHTML) {
    const layer = getModalLayer();
    if (!layer) return;

    layer.innerHTML = `
      <div class="modal-box">
        ${contentHTML}
      </div>
    `;
    layer.style.display = "flex";

    layer.onclick = (e) => {
      if (e.target === layer) {
        closeModal();
      }
    };

    window.addEventListener("keydown", escClose);
  }

  function closeModal() {
    const layer = getModalLayer();
    if (!layer) return;
    layer.style.display = "none";
    layer.innerHTML = "";
    window.removeEventListener("keydown", escClose);
    if (typeof activeOnClose === "function") {
      const fn = activeOnClose;
      activeOnClose = null;
      fn();
    }
  }

  function escClose(e) {
    if (e.key === "Escape") closeModal();
  }

  OL.closeModal = closeModal;

  // ------------------------------------------------------------
  // APP MODAL
  // ------------------------------------------------------------
  OL.openAppModal = function (appId) {
    const app = findAppById(appId);
    if (!app) return;

    activeOnClose = null;
    openModal(renderAppModalHTML(app));
    bindAppModal(app);
  };

  function renderAppModalHTML(app) {
    const usedResources = getResourcesForApp(app.id);

    const resourcesHTML = usedResources.length
      ? usedResources
          .map((r) => `<button class="pill resource">${esc(r.name)}</button>`)
          .join("")
      : `<div class="empty-hint">No resource references.</div>`;

    return `
      <div class="modal-head">
        <button class="icon-edit-btn" id="appIconBtn">${OL.iconHTML(app)}</button>
        <div class="modal-title-text" id="appName" contenteditable="true">
          ${esc(app.name || "")}
        </div>
        <div class="spacer"></div>
        <button class="btn small soft" onclick="OL.closeModal()">Close</button>
      </div>
      <div class="modal-body">
        <div>
          <label class="modal-section-label">Notes</label>
          <div id="appNotesDisplay" class="modal-notes-display ${
            !app.notes ? "muted" : ""
          }">
            ${esc(app.notes || "Click Edit to add notes…")}
          </div>
          <button class="text-link small" id="appNotesEdit">Edit notes</button>
        </div>

        <div>
          <label class="modal-section-label">Functions</label>
          <div class="modal-dot-key">
            <div class="dot primary"></div><span>Primary</span>
            <div class="dot evaluating"></div><span>Evaluating</span>
            <div class="dot available"></div><span>Available</span>
            <div class="modal-dot-help">
                Change status from function card, right-click to remove mapping.
            </div>
          </div>
          <div class="modal-pill-box" id="appFnPills"></div>
          <button class="btn small soft" id="appFnAssignBtn">+ Assign Functions</button>
        </div>

        <div>
          <label class="modal-section-label">Datapoints</label>
          <div id="appDatapoints"></div>
          <button class="btn small soft" id="appAddDatapoint">+ Add Datapoint</button>
        </div>

        <div>
          <label class="modal-section-label">Used in Resources</label>
          <div class="modal-pill-box">
            ${resourcesHTML}
          </div>
        </div>

        <div>
          <label class="modal-section-label">Integrations</label>
          <div id="appIntPills" class="modal-pill-box"></div>
          <button class="btn small soft" id="appIntAddBtn">+ Add Integration</button>
        </div>
      </div>
    `;
  }

  function renderAppModalFunctionPills(app) {
    const layer = getModalLayer();
    if (!layer) return;
    const box = layer.querySelector("#appFnPills");
    if (!box) return;

    let fnAssignments = app.functions || [];
    fnAssignments = [...fnAssignments].sort((a, b) => {
      const order = { primary: 0, evaluating: 1, available: 2 };
      return (
        order[normalizeStatus(a.status)] - order[normalizeStatus(b.status)]
      );
    });

    if (!fnAssignments.length) {
      box.innerHTML = `<span class="pill muted">No functions assigned</span>`;
      return;
    }

    box.innerHTML = fnAssignments
      .map((ref) => {
        const fn = findFunctionById(ref.fnId);
        if (!fn) return "";
        const status = normalizeStatus(ref.status);
        return `
          <span class="pill fn status-${status}"
          oncontextmenu="OL.removeFunctionFromApp(event, '${app.id}', '${fn.id}')"
          >
            ${esc(fn.name)}
          </span>
        `;
      })
      .join("");
  }

  function renderDatapoints(container, app) {
    if (!container) return;
    container.innerHTML = "";

    (app.datapointMappings || []).forEach((dp) => {
      const row = document.createElement("div");
      row.className = "datapoint-row";

      const select = document.createElement("input");
      select.type = "text";
      select.className = "dp-select";
      select.placeholder = "Select datapoint…";
      select.value = getDatapointName(dp.datapointId);

      select.onclick = (e) => {
        e.stopPropagation();
        showDatapointDropdown(select, dp, app);
      };

      row.appendChild(select);

      ["inbound", "outbound"].forEach((field) => {
        const inp = document.createElement("input");
        inp.placeholder = field[0].toUpperCase() + field.slice(1);
        inp.value = dp[field] || "";
        inp.oninput = debounce(() => {
          dp[field] = inp.value;
          OL.persist();
        }, 200);
        row.appendChild(inp);
      });

      const del = document.createElement("div");
      del.className = "card-close";
      del.textContent = "×";
      del.onclick = (e) => {
        e.stopPropagation();
        if (!confirm("Delete this datapoint?")) return;
        app.datapointMappings = app.datapointMappings.filter((x) => x !== dp);
        OL.persist();
        renderDatapoints(container, app);
      };
      row.appendChild(del);

      container.appendChild(row);
    });

    if (!(app.datapointMappings || []).length) {
      container.innerHTML = `<div class="empty-hint">No datapoints yet.</div>`;
    }
  }

  function showDatapointDropdown(select, dpMapping, app) {
    closeAllDatapointDropdowns();
    const used = new Set(
      app.datapointMappings.map((m) => m.datapointId).filter(Boolean),
    );

    const dropdown = document.createElement("div");
    dropdown.className = "dp-dropdown";

    dropdown.innerHTML = `
      <input class="dp-search" placeholder="Search…">
      <div class="dp-options"></div>
    `;

    document.body.appendChild(dropdown);

    const rect = select.getBoundingClientRect();
    dropdown.style.left = rect.left + "px";
    dropdown.style.top = rect.bottom + "px";

    const search = dropdown.querySelector(".dp-search");
    const options = dropdown.querySelector(".dp-options");

    function renderList() {
      const q = (search.value || "").toLowerCase();
      options.innerHTML = "";

      state.datapoints
        .filter((d) => !used.has(d.id))
        .filter((d) => fuzzyMatch(d.name, q))
        .forEach((d) => {
          const opt = document.createElement("div");
          opt.className = "dp-option";
          opt.textContent = d.name;
          opt.onclick = () => {
            dpMapping.datapointId = d.id;
            select.value = d.name;
            OL.persist();
            closeAllDatapointDropdowns();
          };
          options.appendChild(opt);
        });
    }

    search.oninput = renderList;
    search.focus();
    renderList();
  }

  function getDatapointName(dpId) {
    const dp = state.datapoints.find((d) => d.id === dpId);
    return dp ? dp.name : "";
  }

  function closeAllDatapointDropdowns() {
    document.querySelectorAll(".dp-dropdown").forEach((e) => e.remove());
  }

  function renderAppModalIntegrations(container, app) {
    if (!container) return;

    const ints = state.integrations.filter(
      (i) => i.appA === app.id || i.appB === app.id,
    );

    if (!ints.length) {
      container.innerHTML = `<span class="pill muted">None</span>`;
      return;
    }

    container.innerHTML = ints
      .map((int) => {
        const otherId = int.appA === app.id ? int.appB : int.appA;
        const other = findAppById(otherId);
        const name = other ? other.name : "(unknown)";
        return `
          <span
            class="pill integr plain"
            oncontextmenu="OL.removeIntegration(event, '${int.id}')"
          >
            ${esc(name)}
          </span>
        `;
      })
      .join("");
  }

  function openModalIntegrationSelectUI(app) {
    const layer = getModalLayer();
    if (!layer) return;
    const modal = layer.querySelector(".modal-box");
    if (!modal) return;

    const existing = layer.querySelector("#appIntChecklist");
    if (existing) existing.remove();

    const box = document.createElement("div");
    box.id = "appIntChecklist";
    box.innerHTML = `
      <input type="text" class="modal-search" id="appIntSearch" placeholder="Search apps…">
      <div class="modal-checklist" id="appIntList"></div>
    `;
    modal.querySelector(".modal-body").appendChild(box);

    const searchInput = layer.querySelector("#appIntSearch");
    const listDiv = layer.querySelector("#appIntList");

    function renderList() {
      const q = (searchInput.value || "").toLowerCase();
      listDiv.innerHTML = "";

      state.apps
        .filter((a) => a.id !== app.id)
        .filter((a) => (a.name || "").toLowerCase().includes(q))
        .forEach((a) => {
          const exists = state.integrations.some(
            (i) =>
              (i.appA === app.id && i.appB === a.id) ||
              (i.appA === a.id && i.appB === app.id),
          );

          const row = document.createElement("label");
          row.className = "modal-checkrow";

          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = exists;

          cb.onchange = () => {
            if (cb.checked && !exists) {
              state.integrations.push({
                id: uid(),
                appA: app.id,
                appB: a.id,
                type: "zapier",
                direction: "AtoB",
                capabilities: [],
              });
            } else if (!cb.checked && exists) {
              state.integrations = state.integrations.filter(
                (i) =>
                  !(
                    (i.appA === app.id && i.appB === a.id) ||
                    (i.appA === a.id && i.appB === app.id)
                  ),
              );
            }
            OL.persist();
            renderAppModalIntegrations(
              getModalLayer().querySelector("#appIntPills"),
              app,
            );
            renderIntegrationsGrid();
            renderList();
          };

          row.appendChild(cb);
          row.appendChild(document.createTextNode(" " + a.name));
          listDiv.appendChild(row);
        });
    }

    searchInput.oninput = renderList;
    renderList();
  }

  function bindAppModal(app) {
    const layer = getModalLayer();
    if (!layer) return;

    const nameEl = layer.querySelector("#appName");
    const iconBtn = layer.querySelector("#appIconBtn");
    const notesDisplay = layer.querySelector("#appNotesDisplay");
    const notesEdit = layer.querySelector("#appNotesEdit");
    const fnAssignBtn = layer.querySelector("#appFnAssignBtn");
    const dpWrap = layer.querySelector("#appDatapoints");
    const addDpBtn = layer.querySelector("#appAddDatapoint");
    const intWrap = layer.querySelector("#appIntPills");
    const intAddBtn = layer.querySelector("#appIntAddBtn");

    if (nameEl) {
      nameEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          nameEl.blur();
        }
      });
      nameEl.addEventListener("blur", () => {
        const newName = nameEl.textContent.trim();
        if (!newName) return;
        app.name = newName;
        OL.persist();
        renderAppsGrid();
      });
    }

    if (iconBtn) {
      iconBtn.onclick = (e) => {
        e.stopPropagation();
        openIconPicker(app, () => {
          renderAppsGrid();
          OL.openAppModal(app.id);
        });
      };
    }

    function renderNotes() {
      notesDisplay.textContent =
        (app.notes || "").trim() || "Click Edit to add notes…";
      notesDisplay.classList.toggle("muted", !app.notes);
    }
    renderNotes();

    if (notesEdit) {
      notesEdit.onclick = () => {
        const parent = notesDisplay.parentElement;
        const textarea = document.createElement("textarea");
        textarea.className = "modal-textarea";
        textarea.value = app.notes || "";
        parent.insertBefore(textarea, notesDisplay);
        notesDisplay.style.display = "none";
        notesEdit.textContent = "Save notes";

        textarea.focus();

        notesEdit.onclick = () => {
          app.notes = textarea.value;
          OL.persist();
          parent.removeChild(textarea);
          notesDisplay.style.display = "";
          notesEdit.textContent = "Edit notes";
          renderNotes();
          bindAppModal(app);
        };
      };
    }

    renderAppModalFunctionPills(app);

    if (fnAssignBtn) {
      fnAssignBtn.onclick = (e) => {
        e.stopPropagation();
        openAppFunctionAssignUI(app);
      };
    }

    if (!app.datapointMappings) app.datapointMappings = [];
    renderDatapoints(dpWrap, app);

    if (addDpBtn) {
      addDpBtn.onclick = () => {
        app.datapointMappings.push({
          datapointId: null,
          inbound: "",
          outbound: "",
        });
        OL.persist();
        renderDatapoints(dpWrap, app);
      };
    }

    renderAppModalIntegrations(intWrap, app);

    if (intAddBtn) {
      intAddBtn.onclick = (e) => {
        e.stopPropagation();
        openModalIntegrationSelectUI(app);
      };
    }
  }

  function openAppFunctionAssignUI(app) {
    const layer = getModalLayer();
    const fnAssignBtn = layer.querySelector("#appFnAssignBtn");
    if (!fnAssignBtn) return;

    const opts = state.functions.map(fn => ({
      id: fn.id,
      label: fn.name,
      checked: !!(app.functions || []).find(r => r.fnId === fn.id)
    }));

    openMappingDropdown({
      anchorEl: fnAssignBtn,
      options: opts,
      allowMultiple: true,
      onSelect: (fnId, isChecked) => {
        if (isChecked) {
          app.functions = app.functions || [];
          // add it if not already there
          if (!app.functions.find(r => r.fnId === fnId)) {
            const isFirst = OL.functionAssignments(fnId).length === 0;
            const status = isFirst ? "primary" : "available";
            app.functions.push({ fnId, status });
          }
        } else {
          app.functions = (app.functions || []).filter(r => r.fnId !== fnId);
        }

        OL.persist();
        renderAppModalFunctionPills(app);
        renderAppsGrid();
        renderFunctionsGrid();

        const dd = document.querySelector(".mapping-dropdown");
        if (dd && dd.refresh) dd.refresh();
      }
    });
  }

  // ------------------------------------------------------------
  // FUNCTION MODAL
  // ------------------------------------------------------------
  OL.openFunctionModal = function (fnId) {
    const fn = findFunctionById(fnId);
    if (!fn) return;

    activeOnClose = null;
    openModal(renderFunctionModalHTML(fn));
    bindFunctionModal(fn);
  };

  function renderFunctionModalHTML(fn) {
    return `
      <div class="modal-head">
        <button class="icon-edit-btn" id="fnIconBtn">${OL.iconHTML(fn)}</button>
        <div class="modal-title-text" id="fnName" contenteditable="true">
          ${esc(fn.name || "")}
        </div>
        <div class="spacer"></div>
        <button class="btn small soft" onclick="OL.closeModal()">Close</button>
      </div>
      <div class="modal-body">
        <div>
          <label class="modal-section-label">Notes</label>
          <textarea id="fnNotes" class="modal-textarea">${esc(
            fn.notes || "",
          )}</textarea>
        </div>
        <div>
          <label class="modal-section-label">Apps</label>
          <div class="modal-dot-key">
            <div class="dot primary"></div><span>Primary</span>
            <div class="dot evaluating"></div><span>Evaluating</span>
            <div class="dot available"></div><span>Available</span>
            <div class="modal-dot-help">
              Left-click a function to change status, right-click to remove mapping.
            </div>
          </div>
          <div class="modal-pill-box" id="fnAppPills"></div>
          <button class="btn small soft" id="fnAssignBtn">+ Assign Apps</button>
        </div>
      </div>
    `;
  }

  function renderFunctionModalPills(fn) {
    const layer = getModalLayer();
    if (!layer) return;
    const box = layer.querySelector("#fnAppPills");
    if (!box) return;

    const links = OL.functionAssignments(fn.id);
    links.sort((a, b) => {
      const order = { primary: 0, evaluating: 1, available: 2 };
      return (
        order[normalizeStatus(a.status)] - order[normalizeStatus(b.status)]
      );
    });
    if (!links.length) {
      box.innerHTML = `<span class="pill muted">No apps mapped</span>`;
      return;
    }

    box.innerHTML = links
      .map((l) => {
        const status = normalizeStatus(l.status);
        return `
          <span
            class="pill fn status-${status}"
            data-app-id="${l.app.id}"
            onclick="OL.cycleFunctionStatus(event, '${l.app.id}', '${fn.id}')"
            oncontextmenu="OL.removeFunctionFromApp(event, '${l.app.id}', '${fn.id}')"
          >
            ${esc(l.app.name || "")}
          </span>
        `;
      })
      .join("");
  }

  function bindFunctionModal(fn) {
    const layer = getModalLayer();
    if (!layer) return;

    const nameEl = layer.querySelector("#fnName");
    const iconBtn = layer.querySelector("#fnIconBtn");
    const notesEl = layer.querySelector("#fnNotes");
    const assignBtn = layer.querySelector("#fnAssignBtn");

    if (nameEl) {
      nameEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          nameEl.blur();
        }
      });
      nameEl.addEventListener("blur", () => {
        const newName = nameEl.textContent.trim();
        if (!newName) return;
        fn.name = newName;
        OL.persist();
        renderFunctionsGrid();
      });
    }

    if (iconBtn) {
      iconBtn.onclick = (e) => {
        e.stopPropagation();
        openIconPicker(fn, () => {
          renderFunctionsGrid();
          OL.openFunctionModal(fn.id);
        });
      };
    }

    if (notesEl) {
      notesEl.addEventListener(
        "input",
        debounce(() => {
          fn.notes = notesEl.value;
          OL.persist();
        }, 200),
      );
    }

    renderFunctionModalPills(fn);

    if (assignBtn) {
      assignBtn.onclick = (e) => {
        e.stopPropagation();
        openFunctionAppAssignUI(fn);
      };
    }
  }

  function openFunctionAppAssignUI(fn) {
    const layer = getModalLayer();
    const assignBtn = layer.querySelector("#fnAssignBtn");
    if (!assignBtn) return;

    const opts = state.apps.map(app => ({
      id: app.id,
      label: app.name,
      checked: !!(app.functions || []).find(r => r.fnId === fn.id)
    }));

    openMappingDropdown({
      anchorEl: assignBtn,
      options: opts,
      allowMultiple: true,
      onSelect: (appId, isChecked) => {
        const app = findAppById(appId);
        if (!app) return;

        if (isChecked) {
          app.functions = app.functions || [];
          const isFirstForThisFunction =
            OL.functionAssignments(fn.id).length === 0;
          const status = isFirstForThisFunction ? "primary" : "available";
          app.functions.push({ fnId: fn.id, status });
        } else {
          app.functions = (app.functions || []).filter(r => r.fnId !== fn.id);
        }

        OL.persist();
        renderFunctionModalPills(fn);
        renderAppModalFunctionPills(app);
        renderAppsGrid();
        renderFunctionsGrid();

        const dd = document.querySelector(".mapping-dropdown");
        if (dd && dd.refresh) dd.refresh();
      }
    });
  }

  // ------------------------------------------------------------
  // INTEGRATION HELPERS (simple)
  // ------------------------------------------------------------
  OL.addIntegrationFromApp = function (appId) {
    const app = findAppById(appId);
    if (!app) return;

    const otherApps = state.apps.filter((a) => a.id !== appId);
    if (!otherApps.length) {
      alert("No other apps available to integrate with.");
      return;
    }

    const names = otherApps.map((a) => a.name).join("\n");
    const choice = prompt(`Select app to integrate with:\n${names}`);
    if (!choice) return;

    const target = otherApps.find((a) => a.name === choice);
    if (!target) {
      alert("No matching app.");
      return;
    }

    const exists = state.integrations.find(
      (i) =>
        (i.appA === appId && i.appB === target.id) ||
        (i.appA === target.id && i.appB === appId),
    );
    if (exists) {
      alert("Integration already exists.");
      return;
    }

    state.integrations.push({
      id: uid(),
      appA: appId,
      appB: target.id,
      type: "zapier",
      direction: "AtoB",
      capabilities: [],
    });

    OL.persist();
    OL.refreshAllUI();
  };

  // ------------------------------------------------------------
  // INTEGRATION MODAL (capabilities mapping)
  // ------------------------------------------------------------
  OL.openIntegrationModal = function (intId) {
    const int = state.integrations.find((i) => i.id === intId);
    if (!int) return;

    const appA = findAppById(int.appA);
    const appB = findAppById(int.appB);

    openModal(renderIntegrationModalHTML(int, appA, appB));
    bindIntegrationModal(int);
  };

  function renderIntegrationModalHTML(int, appA, appB) {
    const dirLabel =
      int.type === "both"
        ? "Direct & Zapier"
        : int.type === "direct"
          ? "Direct"
          : int.type === "zapier"
            ? "Zapier"
            : "Unspecified";

    return `
      <div class="modal-head">
        <div class="modal-title-text">
          ${esc(appA?.name || "")} ⇄ ${esc(appB?.name || "")}
        </div>
        <div class="spacer"></div>
        <span class="pill integr">${esc(dirLabel)}</span>
        <button class="btn small soft" onclick="OL.closeModal()">Close</button>
      </div>
      <div class="modal-body">
        <div>
          <label class="modal-section-label">Capabilities</label>
          <div id="intCapList">
            ${renderIntegrationCapabilitiesHTML(int)}
          </div>
          <button class="btn small soft" id="intAddCapability">+ Add Capability</button>
        </div>
      </div>
    `;
  }

  function renderIntegrationCapabilitiesHTML(int) {
    const refs = (int.capabilities || [])
      .map((ref) => {
        const cap = state.capabilities.find((c) => c.id === ref.capabilityId);
        return cap ? { ref, cap } : null;
      })
      .filter(Boolean);

    if (!refs.length) {
      return `<div class="empty-hint">No capabilities linked to this integration yet.</div>`;
    }

    const groups = { trigger: [], search: [], action: [] };
    refs.forEach(({ ref, cap }) => {
      const type = cap.type || "action";
      if (!groups[type]) groups[type] = [];
      groups[type].push({ ref, cap });
    });

    const typeOrder = ["trigger", "search", "action"];
    const labels = {
      trigger: "Triggers",
      search: "Searches",
      action: "Actions",
    };

    return typeOrder
      .map((type) => {
        const items = groups[type];
        if (!items || !items.length) return "";
        return `
          <div class="modal-subsection">
            <div class="modal-section-label">${labels[type]}</div>
            <div class="int-cap-table">
              ${items
                .map(({ ref, cap }) => {
                  const it = cap.integrationType || "zapier";
                  const canon = cap.canonicalId
                    ? findCanonicalById(cap.canonicalId)
                    : null;
                  const canonicalLabel =
                    canon?.key ||
                    cap.canonical ||
                    cap.name ||
                    "(Unnamed capability)";
                  return `
                    <div class="int-cap-row" data-cap-ref-id="${ref.id}">
                      <span class="dot-${esc(it)}"></span>
                      <span class="int-cap-canonical">${esc(
                        canonicalLabel,
                      )}</span>
                      <input
                        class="int-cap-label"
                        placeholder="App capability name…"
                        value="${esc(ref.appLabel || "")}"
                      >
                      <div class="card-close int-cap-delete">×</div>
                    </div>
                  `;
                })
                .join("")}
            </div>
          </div>
        `;
      })
      .join("");
  }

  function bindIntegrationModal(int) {
    const layer = getModalLayer();
    if (!layer) return;

    const listEl = layer.querySelector("#intCapList");
    const addBtn = layer.querySelector("#intAddCapability");

    function rerenderList() {
      listEl.innerHTML = renderIntegrationCapabilitiesHTML(int);
      wireRows();
      updateIntegrationTypeFromCapabilities(int);
      OL.persist();
      renderIntegrationsGrid();
    }

    function wireRows() {
      listEl.querySelectorAll(".int-cap-row").forEach((row) => {
        const refId = row.getAttribute("data-cap-ref-id");
        const input = row.querySelector(".int-cap-label");
        const del = row.querySelector(".int-cap-delete");
        if (!input || !del) return;

        input.oninput = debounce(() => {
          const ref = (int.capabilities || []).find((r) => r.id === refId);
          if (!ref) return;
          ref.appLabel = input.value;
          OL.persist();
        }, 200);

        del.onclick = (e) => {
          e.stopPropagation();
          if (!confirm("Remove this capability from the integration?")) return;
          int.capabilities = (int.capabilities || []).filter(
            (r) => r.id !== refId,
          );
          rerenderList();
        };
      });
    }

    wireRows();

    if (addBtn) {
      addBtn.onclick = (e) => {
        e.stopPropagation();
        openIntegrationAddCapabilityUI(int, rerenderList);
      };
    }
  }

  function openIntegrationAddCapabilityUI(int, onDone) {
    const layer = getModalLayer();
    if (!layer) return;
    const existing = layer.querySelector("#intCapAddRow");
    if (existing) existing.remove();

    const container = layer.querySelector(".modal-body");
    if (!container) return;

    const row = document.createElement("div");
    row.id = "intCapAddRow";
    row.className = "int-cap-add-row";
    row.innerHTML = `
      <select id="intCapCanonicalSelect" class="modal-textarea" style="min-height:auto;height:auto;">
        <option value="">Select canonical capability…</option>
          ${state.capabilities
            .slice()
            .sort((a, b) =>
              canonicalLabelForCap(a)
                .toLowerCase()
                .localeCompare(canonicalLabelForCap(b).toLowerCase()),
            )
            .map((cap) => {
              const label = canonicalLabelForCap(cap) || "(Unnamed capability)";
              const appName = findAppById(cap.appId)?.name || "";
              return `
          <option value="${cap.id}">
            ${esc(label)} — ${esc(appName)}
          </option>`;
            })
            .join("")}
      </select>
      <input id="intCapAppLabel" class="modal-textarea" style="min-height:auto;height:auto;"
        placeholder="App capability name (e.g. 'New Contact in App')">
      <button id="intCapSave" class="btn small">Add</button>
    `;

    container.appendChild(row);

    const select = row.querySelector("#intCapCanonicalSelect");
    const labelInput = row.querySelector("#intCapAppLabel");
    const saveBtn = row.querySelector("#intCapSave");

    if (saveBtn) {
      saveBtn.onclick = (e) => {
        e.stopPropagation();
        const capId = select.value;
        const label = (labelInput.value || "").trim();
        if (!capId) {
          alert("Select a canonical capability first.");
          return;
        }
        int.capabilities = int.capabilities || [];
        int.capabilities.push({
          id: uid(),
          capabilityId: capId,
          appLabel: label,
        });
        updateIntegrationTypeFromCapabilities(int);
        OL.persist();
        row.remove();
        if (typeof onDone === "function") onDone();
      };
    }
  }

  //-------------------------------------------------------------
  // DATAPOINT MODAL
  //-------------------------------------------------------------
  function getAppMappingsForDatapoint(dpId) {
    const rows = [];
    state.apps.forEach((app) => {
      (app.datapointMappings || []).forEach((m) => {
        if (m.datapointId === dpId) {
          rows.push({
            app,
            inbound: m.inbound || "",
            outbound: m.outbound || "",
          });
        }
      });
    });
    return rows;
  }

  function renderDatapointModalTable(dp) {
    const rows = getAppMappingsForDatapoint(dp.id);
    if (!rows.length)
      return `<div class="empty-hint">No mappings in any apps.</div>`;

    return `
      <div class="dp-table">
        <div class="dp-table-header">
          <span>Application</span>
          <span>Inbound</span>
          <span>Outbound</span>
        </div>
        ${rows
          .map(
            (r) => `
          <div class="dp-table-row">
            <span class="dp-link-app" data-app-id="${r.app.id}">${esc(r.app.name)}</span>
            <span>${esc(r.inbound)}</span>
            <span>${esc(r.outbound)}</span>
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  }

  OL.openDatapointModal = function (dpId) {
    const dp = state.datapoints.find((d) => d.id === dpId);
    if (!dp) return;

    openModal(`
      <div class="modal-head">
        <div class="modal-title-text" id="dpName" contenteditable="true">${esc(dp.name)}</div>
        <div class="spacer"></div>
        <button class="btn small soft" onclick="OL.closeModal()">Close</button>
      </div>
      <div class="modal-body">

        <label class="modal-section-label">Description</label>
        <textarea id="dpDesc" class="modal-textarea">${esc(dp.description || "")}</textarea>

        <label class="modal-section-label">Used in applications</label>
        <div id="dpMappingsTable">
          ${renderDatapointModalTable(dp)}
        </div>

      </div>
    `);

    const layer = getModalLayer();
    if (!layer) return;

    layer.querySelector("#dpName").onblur = () => {
      dp.name = layer.querySelector("#dpName").textContent.trim();
      OL.persist();
      renderDatapointsGrid();
    };

    layer.querySelector("#dpDesc").oninput = debounce(() => {
      dp.description = layer.querySelector("#dpDesc").value;
      OL.persist();
    }, 200);

    layer.querySelectorAll(".dp-link-app").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        OL.closeModal();
        OL.openAppModal(el.getAttribute("data-app-id"));
      };
    });
  };

  // ------------------------------------------------------------
  // CAPABILITY MODAL
  // ------------------------------------------------------------
  OL.openCapabilityModal = function (capId) {
    const cap = state.capabilities.find((c) => c.id === capId);
    if (!cap) return;

    openModal(renderCapabilityModalHTML(cap));
    bindCapabilityModal(cap);
  };

  function renderCapabilityModalHTML(cap) {
    const appOptions = state.apps
      .map(
        (a) => `
          <option value="${a.id}" ${a.id === cap.appId ? "selected" : ""}>
            ${esc(a.name || "")}
          </option>`,
      )
      .join("");

    const type = cap.type || "trigger";
    const integrationType = cap.integrationType || "zapier";
    const source = cap.source || "manual";

    return `
      <div class="modal-head">
        <div class="modal-title-text">
          ${esc(cap.name || "Capability")}
        </div>
        <div class="spacer"></div>
        <button class="btn small soft" onclick="OL.closeModal()">Close</button>
      </div>
      <div class="modal-body">

        <div>
          <label class="modal-section-label">Name (App Label)</label>
          <input
            id="capName"
            class="modal-textarea"
            style="min-height:auto;height:auto;"
            value="${esc(cap.name || "")}"
          >
        </div>

        <div class="modal-field">
          <label class="modal-section-label">Canonical Key</label>
          <div class="canon-wrapper">
            <input id="canonInput" class="canon-input" placeholder="Search or add…" autocomplete="off">

            <div id="canonDropdown" class="canon-dropdown hidden">
              <input id="canonSearch" class="canon-search" placeholder="Search…" autocomplete="off">
              <div id="canonOptions" class="canon-options"></div>
              <div id="canonAddNew" class="canon-add">+ Add New</div>
            </div>
          </div>
          <div class="modal-notes-display muted">
            Canonical capabilities are app-agnostic definitions like “New Contact Created” or “Meeting Scheduled”.
          </div>
        </div>

        <div class="modal-row">
          <div style="flex:1;min-width:0;">
            <label class="modal-section-label">Integration Type</label>
            <select
              id="capIntegrationType"
              class="modal-textarea"
              style="min-height:auto;height:auto;"
            >
              <option value="direct" ${
                integrationType === "direct" ? "selected" : ""
              }>Direct</option>
              <option value="zapier" ${
                integrationType === "zapier" ? "selected" : ""
              }>Zapier</option>
              <option value="both" ${
                integrationType === "both" ? "selected" : ""
              }>Both</option>
            </select>
          </div>

          <div style="flex:1;min-width:0;">
            <label class="modal-section-label">Type</label>
            <select
              id="capType"
              class="modal-textarea"
              style="min-height:auto;height:auto;"
            >
              <option value="trigger" ${
                type === "trigger" ? "selected" : ""
              }>Trigger</option>
              <option value="search" ${
                type === "search" ? "selected" : ""
              }>Search</option>
              <option value="action" ${
                type === "action" ? "selected" : ""
              }>Action</option>
            </select>
          </div>
        </div>

        <div>
          <label class="modal-section-label">App</label>
          <select
            id="capApp"
            class="modal-textarea"
            style="min-height:auto;height:auto;"
          >
            <option value="">Unassigned</option>
            ${appOptions}
          </select>
        </div>

        <div>
          <label class="modal-section-label">Notes</label>
          <textarea id="capNotes" class="modal-textarea">${esc(
            cap.notes || "",
          )}</textarea>
        </div>

        <div>
          <label class="modal-section-label">Source</label>
          <div class="modal-notes-display muted">
            ${esc(source)}
          </div>
        </div>
      </div>
    `;
  }

  function bindCapabilityModal(cap) {
    const layer = getModalLayer();
    if (!layer) return;

    const nameEl = layer.querySelector("#capName");
    const appEl = layer.querySelector("#capApp");
    const typeEl = layer.querySelector("#capType");
    const integEl = layer.querySelector("#capIntegrationType");
    const notesEl = layer.querySelector("#capNotes");

    const canonInput = layer.querySelector("#canonInput");
    const canonDropdown = layer.querySelector("#canonDropdown");
    const canonSearch = layer.querySelector("#canonSearch");
    const canonOptions = layer.querySelector("#canonOptions");
    const canonAddNew = layer.querySelector("#canonAddNew");

    ensureCanonicalForCap(cap);

    function syncCanonInput() {
      if (canonInput) {
        canonInput.value = canonicalLabelForCap(cap);
      }
    }
    syncCanonInput();

    function renderCanonOptions(filterText) {
      if (!canonOptions) return;
      const q = (filterText || "").toLowerCase();
      const list = (state.canonicalCapabilities || [])
        .slice()
        .filter((c) => (c.key || "").toLowerCase().includes(q))
        .sort((a, b) =>
          (a.key || "").toLowerCase().localeCompare((b.key || "").toLowerCase()),
        );

      canonOptions.innerHTML = list.length
        ? list
            .map(
              (c) =>
                `<div class="canon-option" data-id="${c.id}">${esc(
                  c.key || "",
                )}</div>`,
            )
            .join("")
        : `<div class="canon-option muted">(No matches)</div>`;

      canonOptions
        .querySelectorAll(".canon-option[data-id]")
        .forEach((opt) => {
          opt.onclick = (e) => {
            e.stopPropagation();
            const id = opt.getAttribute("data-id");
            const canon = findCanonicalById(id);
            if (!canon) return;
            cap.canonicalId = canon.id;
            cap.canonical = canon.key;
            syncCanonInput();
            hideCanonDropdown();
            OL.persist();
            renderCapabilitiesGrid();
          };
        });
    }

    function showCanonDropdown() {
      if (!canonDropdown) return;
      canonDropdown.classList.remove("hidden");
      renderCanonOptions(canonSearch ? canonSearch.value : "");
      document.addEventListener("click", outsideCanonHandler, true);
    }

    function hideCanonDropdown() {
      if (!canonDropdown) return;
      canonDropdown.classList.add("hidden");
      document.removeEventListener("click", outsideCanonHandler, true);
    }

    function outsideCanonHandler(evt) {
      const wrapper = layer.querySelector(".canon-wrapper");
      if (!wrapper) return;

      const clickedInside = wrapper.contains(evt.target);
      if (!clickedInside) hideCanonDropdown();
    }

    if (canonInput && canonDropdown && canonSearch) {
      canonInput.addEventListener("click", (e) => {
        e.stopPropagation();
        showCanonDropdown();
      });
      canonInput.addEventListener("focus", (e) => {
        e.stopPropagation();
        showCanonDropdown();
      });
      canonInput.addEventListener("input", () => {
        if (canonSearch) canonSearch.value = canonInput.value;
        renderCanonOptions(canonInput.value);
      });

      canonSearch.addEventListener("input", (e) => {
        renderCanonOptions(e.target.value);
      });

      if (canonAddNew) {
        canonAddNew.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const raw =
            (canonSearch && canonSearch.value.trim()) ||
            (canonInput && canonInput.value.trim()) ||
            "";
          if (!raw) return;

          let canon = findCanonicalByKey(raw);
          if (!canon) {
            canon = {
              id: uid(),
              key: raw,
              type:
                (typeEl && typeEl.value) ||
                cap.type ||
                "trigger",
              notes: "",
              group: "",
            };
            state.canonicalCapabilities =
              state.canonicalCapabilities || [];
            state.canonicalCapabilities.push(canon);
          }

          cap.canonicalId = canon.id;
          cap.canonical = canon.key;
          syncCanonInput();
          hideCanonDropdown();
          OL.persist();
          renderCapabilitiesGrid();
        };
      }

      canonDropdown.addEventListener("click", (e) =>
        e.stopPropagation(),
      );
    }

    if (nameEl) {
      nameEl.addEventListener(
        "input",
        debounce(() => {
          cap.name = nameEl.value.trim();
          OL.persist();
          renderCapabilitiesGrid();
        }, 200),
      );
    }

    if (appEl) {
      appEl.onchange = () => {
        cap.appId = appEl.value || null;
        OL.persist();
        renderCapabilitiesGrid();
      };
    }

    if (typeEl) {
      typeEl.onchange = () => {
        cap.type = typeEl.value;
        // keep canonical type roughly aligned if we just created it
        OL.persist();
        renderCapabilitiesGrid();
      };
    }

    if (integEl) {
      integEl.onchange = () => {
        cap.integrationType = integEl.value;
        syncZapierIntegrationsFromCapabilities();
        OL.persist();
        renderCapabilitiesGrid();
      };
    }

    if (notesEl) {
      notesEl.addEventListener(
        "input",
        debounce(() => {
          cap.notes = notesEl.value;
          OL.persist();
          renderCapabilitiesGrid();
        }, 200),
      );
    }
  }

  OL.deleteCapability = function (capId) {
    const cap = state.capabilities.find((c) => c.id === capId);
    if (!cap) return;
    if (!confirm(`Delete "${cap.name || "this capability"}"?`)) return;

    state.capabilities = state.capabilities.filter((c) => c.id !== capId);
    syncZapierIntegrationsFromCapabilities();
    OL.persist();
    OL.refreshAllUI();
  };

  // ------------------------------------------------------------
  // DELETE APPS / FUNCTIONS / INTEGRATIONS / DATAPOINTS
  // ------------------------------------------------------------
  OL.deleteApp = function (appId) {
    const app = findAppById(appId);
    if (!app) return;
    if (!confirm(`Delete "${app.name}"?`)) return;

    state.apps = state.apps.filter((a) => a.id !== appId);
    state.integrations = state.integrations.filter(
      (i) => i.appA !== appId && i.appB !== appId,
    );

    OL.persist();
    OL.refreshAllUI();
  };

  OL.deleteFunction = function (fnId) {
    const fn = findFunctionById(fnId);
    if (!fn) return;
    if (!confirm(`Delete function "${fn.name}"?`)) return;

    state.functions = state.functions.filter((f) => f.id !== fnId);
    state.apps.forEach((app) => {
      app.functions = (app.functions || []).filter((ref) => ref.fnId !== fnId);
    });

    OL.persist();
    OL.refreshAllUI();
  };

  OL.removeIntegration = function (e, intId) {
    e.preventDefault();
    e.stopPropagation();

    const int = state.integrations.find((i) => i.id === intId);
    if (!int) return;
    if (!confirm("Remove this integration?")) return;

    state.integrations = state.integrations.filter((i) => i.id !== intId);
    OL.persist();

    renderIntegrationsGrid();

    const layer = getModalLayer();
    if (layer && layer.style.display === "flex") {
      const name = layer.querySelector("#appName")?.textContent.trim();
      const appObj = state.apps.find((a) => a.name === name);
      if (appObj) {
        const intWrap = layer.querySelector("#appIntPills");
        renderAppModalIntegrations(intWrap, appObj);
      }
    }
  };

  OL.deleteDatapoint = function (dpId) {
    if (!confirm("Delete this datapoint?")) return;
    state.datapoints = state.datapoints.filter((d) => d.id !== dpId);

    state.apps.forEach((app) => {
      app.datapointMappings = (app.datapointMappings || []).filter(
        (m) => m.datapointId !== dpId,
      );
    });

    OL.persist();
    OL.refreshAllUI();
  };

  // ------------------------------------------------------------
  // LINK / UNLINK FUNCTIONS & APPS
  // ------------------------------------------------------------
  OL.unlinkFunctionAndApp = function (appId, fnId) {
    const app = findAppById(appId);
    if (!app) return false;
    app.functions = (app.functions || []).filter((f) => f.fnId !== fnId);
    OL.persist();
    return true;
  };

  OL.removeFunctionFromApp = function (e, appId, fnId) {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm("Remove this function?")) return;

    if (!OL.unlinkFunctionAndApp(appId, fnId)) return;

    const app = findAppById(appId);
    const fn = findFunctionById(fnId);

    renderAppsGrid();
    renderFunctionsGrid();

    if (app) renderAppModalFunctionPills(app);
    if (fn) renderFunctionModalPills(fn);
  };

  OL.cycleFunctionStatus = function (e, appId, fnId) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    const app = findAppById(appId);
    if (!app) return;

    const ref = (app.functions || []).find((r) => r.fnId === fnId);
    if (!ref) return;

    const cycle = ["available", "evaluating", "primary"];
    const current = normalizeStatus(ref.status);
    const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];

    ref.status = next;
    OL.persist();

    const fn = findFunctionById(fnId);

    renderAppsGrid();
    renderFunctionsGrid();

    if (app) renderAppModalFunctionPills(app);
    if (fn) renderFunctionModalPills(fn);
  };

  // ------------------------------------------------------------
  // ICON PICKER
  // ------------------------------------------------------------
  function openIconPicker(obj, onDone) {
    closeIconPicker();

    const overlay = document.createElement("div");
    overlay.className = "icon-picker-overlay";

    const picker = document.createElement("div");
    picker.className = "icon-picker";
    overlay.appendChild(picker);

    picker.innerHTML = `
      <div class="picker-section">
        <div class="picker-title">Emoji</div>
        <div class="picker-row">
          ${[
            "📅",
            "📇",
            "📤",
            "📩",
            "⚙️",
            "🔐",
            "🧮",
            "📊",
            "🗄",
            "🧾",
            "🧩",
            "💼",
            "🕒",
            "☎️",
            "📎",
            "🎥",
            "📹",
            "📁",
            "📂",
            "⚡",
            "🤼",
            "📞",
            "📆",
            "🗓",
            "📱",
            "📝",
            "✒",
          ]
            .map((e) => `<span class="picker-option emoji">${e}</span>`)
            .join("")}
        </div>
      </div>
      <div class="picker-section">
        <div class="picker-title">Auto-Letter</div>
        <button id="autoIconReset" class="btn small soft">Reset</button>
      </div>
      <div class="picker-section">
        <div class="picker-title">From URL</div>
        <div class="picker-row">
          <input type="text" id="iconUrlInput" placeholder="Paste image URL…">
          <button id="iconUrlApply" class="btn small">Use</button>
        </div>
      </div>
      <div class="picker-section">
        <div class="picker-title">Upload</div>
        <input type="file" accept="image/*" id="uploadIconInput">
      </div>
      <div class="picker-section">
        <button id="removeIconBtn" class="btn small warn">Remove Icon</button>
      </div>
    `;

    document.body.appendChild(overlay);
    window._activeIconPicker = overlay;

    overlay.onclick = (e) => {
      if (e.target === overlay) closeIconPicker();
    };

    picker.querySelectorAll(".picker-option.emoji").forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        obj.icon = { type: "emoji", value: el.textContent };
        OL.persist();
        closeIconPicker();
        if (onDone) onDone();
      };
    });

    picker.querySelector("#autoIconReset").onclick = (ev) => {
      ev.stopPropagation();
      obj.icon = null;
      OL.persist();
      closeIconPicker();
      if (onDone) onDone();
    };

    picker.querySelector("#iconUrlApply").onclick = (ev) => {
      ev.stopPropagation();
      const url = picker.querySelector("#iconUrlInput").value.trim();
      if (!url) return;
      obj.icon = { type: "img", url };
      OL.persist();
      closeIconPicker();
      if (onDone) onDone();
    };

    picker.querySelector("#uploadIconInput").onchange = async (ev) => {
      ev.stopPropagation();
      const file = ev.target.files[0];
      if (!file) return;
      const url = await fileToBase64(file);
      obj.icon = { type: "img", url };
      OL.persist();
      closeIconPicker();
      if (onDone) onDone();
    };

    picker.querySelector("#removeIconBtn").onclick = (ev) => {
      ev.stopPropagation();
      obj.icon = null;
      OL.persist();
      closeIconPicker();
      if (onDone) onDone();
    };
  }

  function closeIconPicker() {
    if (window._activeIconPicker) {
      window._activeIconPicker.remove();
      window._activeIconPicker = null;
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }
  // ------------------------------------------------------------
  // GENERIC MAPPING DROPDOWN (reusable)
  // ------------------------------------------------------------
  function openMappingDropdown({ anchorEl, options, allowMultiple, onSelect }) {
    // close any existing
    let existing = document.querySelector(".mapping-dropdown");
    if (existing) existing.remove();

    const dropdown = document.createElement("div");
    dropdown.className = "mapping-dropdown";

    dropdown.innerHTML = `
      <input class="mapping-search" placeholder="Search…">
      <div class="mapping-options"></div>
    `;

    document.body.appendChild(dropdown);

    // position
    const rect = anchorEl.getBoundingClientRect();
    dropdown.style.left = rect.left + "px";
    dropdown.style.top = rect.bottom + "px";

    const search = dropdown.querySelector(".mapping-search");
    const optionsBox = dropdown.querySelector(".mapping-options");

    function renderList() {
      const q = (search.value || "").toLowerCase();
      optionsBox.innerHTML = "";

      options
        .filter(o => !o.checked)                // <— hides already-selected!
        .filter(o => (o.label || "").toLowerCase().includes(q))
        .forEach(o => {
          const row = document.createElement("div");
          row.className = "mapping-option";

          if (allowMultiple) {
            row.innerHTML = `<span class="mapping-multi-label ${o.checked ? "checked" : ""}">
              ${o.label}
            </span>`;
          } else {
            row.innerHTML = `<span>${o.label}</span>`;
          }

          row.onclick = (e) => {
            e.stopPropagation();
            if (allowMultiple) {
              const checked = !o.checked;
              o.checked = checked;
              onSelect(o.id, checked);
              row.classList.toggle("checked", checked);
            } else {
              onSelect(o.id);
              closeMappingDropdown();
            }
          };

          optionsBox.appendChild(row);
        });
    }
    dropdown.refresh = () => renderList();
    search.oninput = renderList;
    renderList();

    function closeMappingDropdown() {
      document.removeEventListener("click", outside, true);
      dropdown.remove();
    }

    function outside(evt) {
      if (!dropdown.contains(evt.target)) {
        closeMappingDropdown();
      }
    }

    document.addEventListener("click", outside, true);
  }

  // ------------------------------------------------------------
  // BOOT
  // ------------------------------------------------------------
  document.addEventListener("click", (e) => {
    const layer = document.getElementById("modal-layer");
    if (!layer || layer.style.display !== "flex") return;

    const fnList = layer.querySelector("#appFnChecklist");
    if (fnList && !fnList.contains(e.target)) fnList.remove();

    const appList = layer.querySelector("#fnAppChecklist");
    if (appList && !appList.contains(e.target)) appList.remove();

    const intList = layer.querySelector("#appIntChecklist");
    if (intList && !intList.contains(e.target)) intList.remove();
  });

  document.addEventListener("click", (e) => {
    const inDropdown = e.target.closest(".dp-dropdown");
    const inTrigger = e.target.closest(".dp-select");
    if (inDropdown || inTrigger) return;
    closeAllDatapointDropdowns();
  });

  function handleRoute() {
    const hash = location.hash || "";

    const isDatapoints = hash.startsWith("#/settings/datapoints");
    const isCanonicalCaps = hash.startsWith("#/settings/canonical-capabilities");
    const isCapabilities = hash.startsWith("#/triggers-actions");

    const showAppsSet = !isDatapoints && !isCanonicalCaps && !isCapabilities;

    const appsSection = document.getElementById("section-apps");
    const fnsSection = document.getElementById("section-functions");
    const intsSection = document.getElementById("section-integrations");
    const capsSection = document.getElementById("section-capabilities");
    const dpsSection = document.getElementById("section-datapoints");
    const canonSection = document.getElementById("section-canonical-caps");

    if (appsSection) appsSection.style.display = showAppsSet ? "block" : "none";
    if (fnsSection) fnsSection.style.display = showAppsSet ? "block" : "none";
    if (intsSection) intsSection.style.display = showAppsSet ? "block" : "none";

    if (capsSection)
      capsSection.style.display = isCapabilities ? "block" : "none";
    if (dpsSection) dpsSection.style.display = isDatapoints ? "block" : "none";
    if (canonSection)
      canonSection.style.display = isCanonicalCaps ? "block" : "none";
  }

  document.addEventListener("DOMContentLoaded", () => {
    buildLayout();
    wireCapabilityViewToggle();
    migrateCanonicalFromLegacy();
    syncZapierIntegrationsFromCapabilities();
    OL.refreshAllUI();
    handleRoute();
  });

  window.addEventListener("hashchange", handleRoute);
})();
