;(() => {
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
  OL.utils = {
    uid() {
      return "id_" + Math.random().toString(36).slice(2, 10);
    },
    esc(s) {
      return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
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

  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------
  OL.state = {
    apps: OL.store.get("apps", defaultApps),
    functions: OL.store.get("functions", defaultFunctions),
    integrations: OL.store.get("integrations", defaultIntegrations),
    resources: OL.store.get("resources", defaultResources),
  };

  const state = OL.state;

  // ------------------------------------------------------------
  // PERSIST
  // ------------------------------------------------------------
  OL.persist = debounce(() => {
    OL.store.set("apps", state.apps);
    OL.store.set("functions", state.functions);
    OL.store.set("integrations", state.integrations);
    OL.store.set("resources", state.resources);
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
  // GLOBAL UI REFRESH (does NOT rebuild layout)
  // ------------------------------------------------------------
  OL.refreshAllUI = function () {
    renderAppsGrid();
    renderFunctionsGrid();
    renderIntegrationsGrid();
  };

  // ------------------------------------------------------------
  // LAYOUT (built once)
  // ------------------------------------------------------------
  function buildLayout() {
    const root = document.getElementById("app-root");
    if (!root) return;

    root.innerHTML = `
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
        <!-- Status pill key -->
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
        <!-- Status pill key -->
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
      (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase())
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
        return order[normalizeStatus(a.status)] - order[normalizeStatus(b.status)];
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

    const ints = state.integrations.filter(
      (i) => i.appA === app.id || i.appB === app.id
    );

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
            <div class="card-section-title">Integrations</div>
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
      (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase())
    );

    fns.forEach((fn) => {
      grid.insertAdjacentHTML("beforeend", renderFunctionCard(fn));
    });
  }

  function renderFunctionCard(fn) {
    const links = OL.functionAssignments(fn.id);
    links.sort((a, b) => {
      const order = { primary: 0, evaluating: 1, available: 2 };
      return order[normalizeStatus(a.status)] - order[normalizeStatus(b.status)];
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

    // dedupe logical pair representation
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

      grid.insertAdjacentHTML(
        "beforeend",
        `
        <div class="card" data-int-id="${int.id}">
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
              <div class="card-section-title">
                ${esc(appA?.name || "")} Triggers: 
                ${(int.countTriggersDirect || 0)
                  + (int.countTriggersZapier || 0)
                  + (int.countTriggersBoth || 0)}
              </div>
              <div class="pills-row">
                <div class="count-line">
                  <span class="dot-direct"></span><span>${int.countTriggersDirect || 0}</span>
                  <span class="dot-zapier"></span><span>${int.countTriggersZapier || 0}</span>
                  <span class="dot-both"></span><span>${int.countTriggersBoth || 0}</span>
                </div>
              </div>
            </div>

            <div class="card-section">
              <div class="card-section-title">
                ${esc(appB?.name || "")} Searches: 
                ${(int.countSearchesDirect || 0)
                  + (int.countSearchesZapier || 0)
                  + (int.countSearchesBoth || 0)}
              </div>
              <div class="pills-row">
                <div class="count-line">
                  <span class="dot-direct"></span><span>${int.countSearchesDirect || 0}</span>
                  <span class="dot-zapier"></span><span>${int.countSearchesZapier || 0}</span>
                  <span class="dot-both"></span><span>${int.countSearchesBoth || 0}</span>
                </div>
              </div>
            </div>

            <div class="card-section">
              <div class="card-section-title">
                ${esc(appB?.name || "")} Actions: 
                ${(int.countActionsDirect || 0)
                  + (int.countActionsZapier || 0)
                  + (int.countActionsBoth || 0)}
              </div>
              <div class="pills-row">
                <div class="count-line">
                  <span class="dot-direct"></span><span>${int.countActionsDirect || 0}</span>
                  <span class="dot-zapier"></span><span>${int.countActionsZapier || 0}</span>
                  <span class="dot-both"></span><span>${int.countActionsBoth || 0}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      `
      );
    });

    // clicking the ↔ swaps appA / appB
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

    // right-click on Type pill changes the integration type
    grid.querySelectorAll(".pill.integr-type").forEach((el) => {
      el.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = el.getAttribute("data-int-id");
        const int = state.integrations.find((i) => i.id === id);
        if (!int) return;

        const order = ["zapier", "direct", "both"];
        const idx = order.indexOf(int.type || "zapier");
        int.type = order[(idx + 1) % order.length];

        OL.persist();
        renderIntegrationsGrid();
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
        // Keep this simple and not broken.
        alert('To add an integration, open an App card and use "+ Add Integration" in the modal.');
      };
    }
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
    const dpMappings = app.datapointMappings || [];
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
      return order[normalizeStatus(a.status)] - order[normalizeStatus(b.status)];
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

      const del = document.createElement("div");
      del.className = "card-close";
      del.textContent = "×";
      del.title = "Remove datapoint";

      del.onclick = (e) => {
        e.stopPropagation();
        if (!confirm("Delete this datapoint?")) return;

        app.datapointMappings = app.datapointMappings.filter((x) => x !== dp);
        OL.persist();
        renderDatapoints(container, app);
      };
      row.appendChild(del);

      row.className = "datapoint-row";

      ["master", "inbound", "outbound"].forEach((field) => {
        const inp = document.createElement("input");
        inp.placeholder =
          field[0].toUpperCase() + field.slice(1); // Master / Inbound / Outbound
        inp.value = dp[field] || "";
        inp.oninput = debounce(() => {
          dp[field] = inp.value;
          OL.persist();
        }, 200);
        row.appendChild(inp);
      });
      row.appendChild(del);

      container.appendChild(row);
    });

    if (!(app.datapointMappings || []).length) {
      container.innerHTML = `<div class="empty-hint">No datapoints yet.</div>`;
    }
  }

  function renderAppModalIntegrations(container, app) {
    if (!container) return;

    const ints = state.integrations.filter(
      (i) => i.appA === app.id || i.appB === app.id
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
              (i.appA === a.id && i.appB === app.id)
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
              });
            } else if (!cb.checked && exists) {
              state.integrations = state.integrations.filter(
                (i) =>
                  !(
                    (i.appA === app.id && i.appB === a.id) ||
                    (i.appA === a.id && i.appB === app.id)
                  )
              );
            }
            OL.persist();
            renderAppModalIntegrations(
              getModalLayer().querySelector("#appIntPills"),
              app
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

    // Name
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

    // Icon
    if (iconBtn) {
      iconBtn.onclick = (e) => {
        e.stopPropagation();
        openIconPicker(app, () => {
          renderAppsGrid();
          OL.openAppModal(app.id);
        });
      };
    }

    // Notes
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

    // Functions assign
    renderAppModalFunctionPills(app);

    if (fnAssignBtn) {
      fnAssignBtn.onclick = () => openAppFunctionAssignUI(app);
    }

    fnAssignBtn.onclick = (e) => {
      e.stopPropagation();
      openAppFunctionAssignUI(app);
    };

    // Datapoints
    if (!app.datapointMappings) app.datapointMappings = [];
    renderDatapoints(dpWrap, app);

    if (addDpBtn) {
      addDpBtn.onclick = () => {
        app.datapointMappings.push({ master: "", inbound: "", outbound: "" });
        OL.persist();
        renderDatapoints(dpWrap, app);
      };
    }

    // Integrations
    renderAppModalIntegrations(intWrap, app);

    if (intAddBtn) {
      intAddBtn.onclick = () => openModalIntegrationSelectUI(app);
    }

    intAddBtn.onclick = (e) => {
      e.stopPropagation();
      openModalIntegrationSelectUI(app);
    };

  }

  function openAppFunctionAssignUI(app) {
    const layer = getModalLayer();
    if (!layer) return;
    const modal = layer.querySelector(".modal-box");
    if (!modal) return;
    const container = layer.querySelector("#appFnPills");
    if (!container) return;

    const existing = layer.querySelector("#appFnChecklist");
    if (existing) existing.remove();

    const checklist = document.createElement("div");
    checklist.id = "appFnChecklist";

    checklist.innerHTML = `
      <input type="text" class="modal-search" id="appFnSearch" placeholder="Search functions…">
      <div class="modal-checklist" id="appFnList"></div>
    `;

    container.insertAdjacentElement("afterend", checklist);

    const searchInput = layer.querySelector("#appFnSearch");
    const listDiv = layer.querySelector("#appFnList");

    function renderList() {
      const q = (searchInput.value || "").toLowerCase();
      listDiv.innerHTML = "";

      state.functions
        .filter((fn) => (fn.name || "").toLowerCase().includes(q))
        .forEach((fn) => {
          const existing = (app.functions || []).find((r) => r.fnId === fn.id);
          const row = document.createElement("label");
          row.className = "modal-checkrow";

          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.dataset.fnId = fn.id;
          cb.dataset.appId = app.id;
          cb.checked = !!existing;

          cb.onchange = () => {
            if (cb.checked) {
              app.functions = app.functions || [];

              const isFirst = OL.functionAssignments(fn.id).length === 0;
              const status = isFirst ? "primary" : "available";

              app.functions.push({ fnId: fn.id, status });

              // CRITICAL: also reflect on function-side view
              OL.persist();
              renderFunctionModalPills(fn);
              renderAppModalFunctionPills(app);
              renderAppsGrid();
              renderFunctionsGrid();
            } else {
              OL.unlinkFunctionAndApp(app.id, fn.id);
            }
            OL.persist();
            renderAppModalFunctionPills(app);
            renderAppsGrid();
            renderFunctionsGrid();
          };

          row.appendChild(cb);
          row.appendChild(document.createTextNode(" " + fn.name));
          listDiv.appendChild(row);
        });
    }

    searchInput.oninput = renderList;
    renderList();
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
            fn.notes || ""
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
      return order[normalizeStatus(a.status)] - order[normalizeStatus(b.status)];
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
        }, 200)
      );
    }

    renderFunctionModalPills(fn);

    if (assignBtn) {
      assignBtn.onclick = () => openFunctionAppAssignUI(fn);
    }

    assignBtn.onclick = (e) => {
      e.stopPropagation();
      openFunctionAppAssignUI(fn);
    };
  }

  function openFunctionAppAssignUI(fn) {
    const layer = getModalLayer();
    if (!layer) return;
    const modal = layer.querySelector(".modal-box");
    if (!modal) return;

    const existing = layer.querySelector("#fnAppChecklist");
    if (existing) existing.remove();

    const box = document.createElement("div");
    box.id = "fnAppChecklist";
    box.innerHTML = `
      <input type="text" class="modal-search" id="fnAppSearch" placeholder="Search apps…">
      <div class="modal-checklist" id="fnAppList"></div>
    `;
    modal.querySelector(".modal-body").appendChild(box);

    const searchInput = layer.querySelector("#fnAppSearch");
    const listDiv = layer.querySelector("#fnAppList");

    function renderList() {
      const q = (searchInput.value || "").toLowerCase();
      listDiv.innerHTML = "";

      state.apps
        .filter((a) => (a.name || "").toLowerCase().includes(q))
        .forEach((app) => {
          const existing = (app.functions || []).find((r) => r.fnId === fn.id);
          const row = document.createElement("label");
          row.className = "modal-checkrow";

          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.dataset.fnId = fn.id;
          cb.dataset.appId = app.id;
          cb.checked = !!existing;

          cb.onchange = () => {
            if (cb.checked) {
              app.functions = app.functions || [];

              const isFirstForThisFunction = OL.functionAssignments(fn.id).length === 0;
              const status = isFirstForThisFunction ? "primary" : "available";

              app.functions.push({ fnId: fn.id, status });

              OL.persist();
              renderFunctionModalPills(fn);
              renderAppModalFunctionPills(app);
              renderAppsGrid();
              renderFunctionsGrid();
            } else {
              OL.unlinkFunctionAndApp(app.id, fn.id);
            }
            OL.persist();
            renderFunctionModalPills(fn);
            renderAppsGrid();
            renderFunctionsGrid();
          };

          row.appendChild(cb);
          row.appendChild(document.createTextNode(" " + app.name));
          listDiv.appendChild(row);
        });
    }

    searchInput.oninput = renderList;
    renderList();
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
        (i.appA === target.id && i.appB === appId)
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
    });

    OL.persist();
    OL.refreshAllUI();
  };

  // ------------------------------------------------------------
  // DELETE APPS / FUNCTIONS / INTEGRATIONS
  // ------------------------------------------------------------
  OL.deleteApp = function (appId) {
    const app = findAppById(appId);
    if (!app) return;
    if (!confirm(`Delete "${app.name}"?`)) return;

    state.apps = state.apps.filter((a) => a.id !== appId);
    state.integrations = state.integrations.filter(
      (i) => i.appA !== appId && i.appB !== appId
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
      app.functions = (app.functions || []).filter(
        (ref) => ref.fnId !== fnId
      );
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

    // Update integrations grid and app modal if open
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

    // Update cards
    renderAppsGrid();
    renderFunctionsGrid();

    // Update modals if open
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

    // Update cards
    renderAppsGrid();
    renderFunctionsGrid();

    // Update modals if open
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

    // emoji
    picker.querySelectorAll(".picker-option.emoji").forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        obj.icon = { type: "emoji", value: el.textContent };
        OL.persist();
        closeIconPicker();
        if (onDone) onDone();
      };
    });

    // reset
    picker.querySelector("#autoIconReset").onclick = (ev) => {
      ev.stopPropagation();
      obj.icon = null;
      OL.persist();
      closeIconPicker();
      if (onDone) onDone();
    };

    // URL
    picker.querySelector("#iconUrlApply").onclick = (ev) => {
      ev.stopPropagation();
      const url = picker.querySelector("#iconUrlInput").value.trim();
      if (!url) return;
      obj.icon = { type: "img", url };
      OL.persist();
      closeIconPicker();
      if (onDone) onDone();
    };

    // upload
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

    // remove
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
  // BOOT
  // ------------------------------------------------------------
  document.addEventListener("click", (e) => {
    const layer = document.getElementById("modal-layer");
    if (!layer || layer.style.display !== "flex") return;

    // close function dropdown
    const fnList = layer.querySelector("#appFnChecklist");
    if (fnList && !fnList.contains(e.target)) fnList.remove();

    // close app dropdown
    const appList = layer.querySelector("#fnAppChecklist");
    if (appList && !appList.contains(e.target)) appList.remove();

    // close integration dropdown
    const intList = layer.querySelector("#appIntChecklist");
    if (intList && !intList.contains(e.target)) intList.remove();
  });

  document.addEventListener("DOMContentLoaded", () => {
    buildLayout();
    OL.refreshAllUI();
  });
})();
