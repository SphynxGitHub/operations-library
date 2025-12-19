(() => {
  // ------------------------------------------------------------
  // CORE NAMESPACE
  // ------------------------------------------------------------
  const OL = {};
  window.OL = OL;

  // ------------------------------------------------------------
  // GLOBAL DATAPOINT MAPPING
  //-------------------------------------------------------------
  OL.activeEditable = null;
  OL.activeRange = null;

  // Data-point Token Insertion Module (for editable fields)
  (() => {
      if (!window.OL) {
          console.error("OL namespace not initialized before datapoints token logic.");
          return;
      }

      // Helper to remove the dropdown from the DOM when done
      function closeDatapointDropdown() {
          const existing = document.querySelector("#dpDropdown");
          if (existing) existing.remove();
          document.removeEventListener('click', outsideClickListener, true);
      }
      
      // Global click listener to close the dropdown when clicking elsewhere
      function outsideClickListener(e) {
          const dropdown = document.querySelector("#dpDropdown");
          // Check if the click target is NOT the dropdown AND NOT the button that opened it
          if (dropdown && !dropdown.contains(e.target) && e.target.id !== 'btnInsertDatapoint') {
              closeDatapointDropdown();
          }
      }

      /* Injects the "+ Datapoint" button into a specific modal header.*/
      OL.injectDatapointButtonToActiveModal = function() {
          const modalHead = document.querySelector(".modal-head");
          if (!modalHead || document.getElementById("modalHeaderAddDp")) return;

          const btn = document.createElement("button");
          btn.id = "modalHeaderAddDp";
          btn.className = "btn xsmall soft";
          btn.style.marginRight = "12px";
          btn.innerHTML = "+ Datapoint";
          
          btn.onclick = (e) => {
              e.stopPropagation();
              
              if (!OL.activeEditable) {
                  alert("Please click into a field first where you want to insert the datapoint token.");
                  return;
              }

              OL.openDatapointDropdown(e.currentTarget, (dp) => {
                  if (typeof OL.insertDatapointToken === 'function') {
                      OL.insertDatapointToken(OL.activeEditable, dp.key);
                  }
                  OL.persist();
              });
          };

          // Insert before the standard "Close" button
          const closeBtn = modalHead.querySelector("button:last-child");
          modalHead.insertBefore(btn, closeBtn);
      };

      /**
       * Renders and displays a dropdown containing all global datapoints.
       * @param {HTMLElement} anchorEl - The element to anchor the dropdown position to.
       * @param {function(object): void} onSelect - Callback executed when a datapoint is selected.
       */
      // Inside the configuration for your Datapoint Dropdown
      OL.openDatapointDropdown = function(anchorEl, onSelect) {
          openMappingDropdown({
              anchorEl: anchorEl,
              options: state.datapoints.map(dp => ({ id: dp.id, label: dp.name, key: dp.key })),
              searchTerm: "",
              placeholder: "Search or create datapoint...",
              
              // This is the "Add from search" logic
              injectOnEmpty: {
                  text: "+ Create new datapoint: '{query}'",
                  onClick: (query) => {
                      const newDp = {
                          id: OL.utils.uid(),
                          name: query.trim(),
                          key: query.trim().toLowerCase().replace(/\s+/g, '_'),
                          description: "",
                          objectType: "General",
                          _sortIndex: state.datapoints.length
                      };
                      
                      state.datapoints.push(newDp);
                      OL.persist();
                      renderDatapointsGrid(); // Update the main library in background
                      
                      // Automatically select the newly created DP
                      onSelect(newDp);
                  }
              },
              onSelect: (selected) => {
                  const dp = state.datapoints.find(d => d.id === selected.id);
                  if (dp) onSelect(dp);
              }
          });
      };
  })();
  // --- Global Focus and Button Wiring ---

  // Tracks the active editable element AND its last known cursor position (selection range)
  document.addEventListener("focusin", (e) => {
      const el = e.target;
      // Match the contenteditable DIV or other supported fields
      if (el.matches("[contenteditable='true'], input[type='text'], textarea")) {
          OL.activeEditable = el;
      }
  });

// CRITICAL NEW LISTENER: Tracks the cursor/range whenever the user clicks/types in the active field
document.addEventListener("selectionchange", () => {
    if (OL.activeEditable && OL.activeEditable.matches("[contenteditable='true']")) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            // Store the range to ensure insertion happens at the cursor location
            OL.activeRange = selection.getRangeAt(0);
        }
    }
});

  // Handler for the "Insert Datapoint" button
  const btnInsertDatapoint = document.getElementById("btnInsertDatapoint");
  if (btnInsertDatapoint) {
      btnInsertDatapoint.onclick = (e) => {
          if (!OL.activeEditable) {
              alert("Please click into a field first where you want to insert the datapoint token.");
              return;
          }

          // Open the dropdown, passing a callback to handle the selected datapoint
          OL.openDatapointDropdown(e.currentTarget, (dp) => {
              // 1. Insert the token (relies on OL.insertDatapointToken being defined elsewhere)
              if (typeof OL.insertDatapointToken === 'function') {
                  OL.insertDatapointToken(OL.activeEditable, dp.key);
              }
              
              // 2. Persist the change (if insertion modifies state that needs saving)
              OL.persist();
          });
      };
  }
  /**
   * Inserts the given token string wrapped in a pill span into the active editable element.
   * This function prioritizes reliable HTML insertion for contenteditable fields.
   * * @param {HTMLElement} element - The currently focused input/contenteditable element.
   * @param {string} tokenString - The datapoint name (e.g., "Client Name").
   */
    // In OL.insertDatapointToken = function(element, tokenString) { ... }

    OL.insertDatapointToken = function(element, tokenString) {
        // The HTML structure we want to insert (pill class and unbreakable space)
        const pillHTML = `<span class="datapoint-pill-inserted" contenteditable="false">${tokenString}</span>\u00A0`;
        
        if (element.matches("[contenteditable='true']")) {
            
            // Use the globally tracked range (OL.activeRange) if available.
            let rangeToUse = OL.activeRange; 
            
            // FALLBACK: If range is lost (e.g., after button click), set it to the end of the element.
            if (!rangeToUse || !element.contains(rangeToUse.startContainer)) {
                rangeToUse = document.createRange();
                rangeToUse.selectNodeContents(element);
                rangeToUse.collapse(false); // Collapse to the end of the element
            }
            
            if (rangeToUse) {
                
                const template = document.createElement('template');
                template.innerHTML = pillHTML.trim();
                const fragment = template.content;
                
                // 1. Insert the HTML at the cursor/range location
                rangeToUse.deleteContents(); 
                rangeToUse.insertNode(fragment); 
                
                // 2. Reset the cursor (selection) immediately after the inserted node 
                const lastNode = rangeToUse.endContainer.lastChild; 
                if (lastNode) {
                    rangeToUse.setStartAfter(lastNode);
                    rangeToUse.setEndAfter(lastNode);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(rangeToUse);
                }

                // 3. CRITICAL: Manually trigger the 'input' event to force persistence/update
                // This ensures the pill is immediately saved and the preview updates.
                element.dispatchEvent(new Event('input', { bubbles: true })); 
            }
            
        } else {
            // ... (Simple text insertion for Input/Textarea remains the same)
            const value = element.value;
            const start = element.selectionStart;
            const end = element.selectionEnd;
            element.value = value.substring(0, start) + tokenString + value.substring(end);
            element.selectionStart = element.selectionEnd = start + tokenString.length;
            
            // Simple inputs also need an input event triggered manually
            element.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        element.focus();
        // OL.persist() is called inside the 'input' event listener's debounce.
    };
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
        .replace(/"/g, '"');
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
  
  const defaultFeatures = [
    { id: uid(), name: "Multi-factor Authentication (MFA)", category: "Security" },
    { id: uid(), name: "Single Sign-On (SSO)", category: "Security" },
    { id: uid(), name: "Audit Logs", category: "Security" },
    { id: uid(), name: "Robust Mobile App", category: "General" },
    { id: uid(), name: "Customer Support Quality", category: "General" },
    { id: uid(), name: "Public API Available", category: "Integration" },
    { id: uid(), name: "Built-in Zapier/Connectors", category: "Integration" },
  ];

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
      objectType: "Contact",
    },
    {
      id: uid(),
      name: "Client Name",
      description: "Full concatenated name of client",
      objectType: "Contact",
    },
    {
      id: uid(),
      name: "Household ID",
      description: "Unique household entity identifier",
      objectType: "Household",
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

  // Update your default data / state initialization
  const defaultWorkflowStages = [
      { id: uid(), name: "01 - Prospecting", sortIndex: 0 },
      { id: uid(), name: "02 - Onboarding", sortIndex: 1 },
      { id: uid(), name: "03 - Ongoing Service", sortIndex: 2 }
  ];

  const defaultWorkflows = [
      { 
          id: uid(), 
          name: "Standard Client Onboarding", 
          description: "The primary process for new ongoing relationships.", 
          stages: [
              { id: uid(), name: "Introduction & Contract", sortIndex: 0 },
              { id: uid(), name: "Discovery & Data Gathering", sortIndex: 1 },
              { id: uid(), name: "Implementation & Launch", sortIndex: 2 },
          ],
          nodes: [
              // Example Step (Manual task)
              { id: uid(), type: 'step', stageId: 'STAGE_ID_1', sortIndex: 0, name: 'Client Welcome Call', ownerId: null, dueDate: null, description: 'Schedule the kickoff meeting.' },
              
              // Example Resource Link (Automation/System step)
              { id: uid(), type: 'resource', stageId: 'STAGE_ID_2', sortIndex: 0, resourceId: 'RESOURCE_ID_A', notes: 'Automated contact import.' },
          ],
      }
  ];

// Note: You must replace 'STAGE_ID_1', 'STAGE_ID_2', and 'RESOURCE_ID_A' with valid IDs 
// if you want your default to render correctly. I recommend creating a simple one manually 
// via the UI once we implement it!

  const defaultCapabilities = [];
  const defaultCanonicalCapabilities = [];

  const defaultTeamMembers = [
    {
      id: uid(),
      name: "Sample Team Member",
      email: "",
      title: "",
      notes: "",
      icon: null,
      roles: [],
    },
  ];
  const defaultTeamRoles = [
    {
      id: uid(),
      name: "Advisor",
      description: "Primary client-facing advisor",
      notes: "",
    },
    {
      id: uid(),
      name: "Operations",
      description: "Back-office and process management",
      notes: "",
    },
  ];
  // ------------------------------------------------------------
  // DEFAULT SEGMENT CATEGORIES + SEGMENTS
  // ------------------------------------------------------------
  const defaultSegmentCategories = (() => {
    const generate = () => {
      const uidValue = OL.utils.uid;

      const makeCat = (name, description, labels) => ({
        id: uidValue(),
        name,
        description,
        values: labels.map((label) => ({ id: uidValue(), label })),
      });

      const lifecycle = makeCat(
        "Lifecycle",
        "Where they are in the relationship lifecycle.",
        ["Lead", "Prospect", "Client", "Former Client"],
      );

      const status = makeCat(
        "Status",
        "Whether the relationship is currently active.",
        ["Active", "Inactive", "Dormant"],
      );

      const engagement = makeCat("Engagement Type", "How you work with them.", [
        "Ongoing (AUM / Retainer)",
        "Ongoing (Subscription)",
        "One-time / Project",
        "Legacy / Dormant",
        "Pre-engagement / Prospect",
      ]);

      const income = makeCat("Income / Wealth Level", "Financial profile.", [
        "HENRY / Upper",
        "Mass affluent / Mid",
        "Varies",
      ]);

      const responsiveness = makeCat(
        "Responsiveness",
        "How quickly and reliably they respond.",
        ["Highly responsive", "Normal", "Low responsiveness"],
      );

      const cats = [lifecycle, status, engagement, income, responsiveness];

      const byId = Object.fromEntries(cats.map((c) => [c.id, c]));
      const byName = Object.fromEntries(cats.map((c) => [c.name, c]));

      const valId = (catName, label) => {
        const cat = byName[catName];
        if (!cat) return null;
        const v = cat.values.find((v) => v.label === label);
        return v ? v.id : null;
      };

      const defaultSegments = [
        {
          id: uidValue(),
          name: "A – Ideal Ongoing Client",
          description:
            "High-fit, highly profitable ongoing client with strong engagement.",
          rules: [
            { categoryId: lifecycle.id, valueId: valId("Lifecycle", "Client") },
            { categoryId: status.id, valueId: valId("Status", "Active") },
            {
              categoryId: engagement.id,
              valueId: valId("Engagement Type", "Ongoing (AUM / Retainer)"),
            },
            {
              categoryId: income.id,
              valueId: valId("Income / Wealth Level", "HENRY / Upper"),
            },
            {
              categoryId: responsiveness.id,
              valueId: valId("Responsiveness", "Highly responsive"),
            },
          ],
        },
        {
          id: uidValue(),
          name: "B – Core Ongoing Client",
          description:
            "Good-fit ongoing client with solid profitability and engagement.",
          rules: [
            { categoryId: lifecycle.id, valueId: valId("Lifecycle", "Client") },
            { categoryId: status.id, valueId: valId("Status", "Active") },
            {
              categoryId: engagement.id,
              valueId: valId("Engagement Type", "Ongoing (AUM / Retainer)"),
            },
            {
              categoryId: income.id,
              valueId: valId("Income / Wealth Level", "Mass affluent / Mid"),
            },
            {
              categoryId: responsiveness.id,
              valueId: valId("Responsiveness", "Normal"),
            },
          ],
        },
        {
          id: uidValue(),
          name: "Prospect – Qualified Lead",
          description: "Qualified prospect with clear need and reasonable fit.",
          rules: [
            {
              categoryId: lifecycle.id,
              valueId: valId("Lifecycle", "Prospect"),
            },
            { categoryId: status.id, valueId: valId("Status", "Active") },
            {
              categoryId: engagement.id,
              valueId: valId("Engagement Type", "Pre-engagement / Prospect"),
            },
          ],
        },
        {
          id: uidValue(),
          name: "Dormant / Inactive Client",
          description:
            "Client with minimal recent activity; may need re-engagement or offboarding.",
          rules: [
            { categoryId: lifecycle.id, valueId: valId("Lifecycle", "Client") },
            { categoryId: status.id, valueId: valId("Status", "Inactive") },
            {
              categoryId: engagement.id,
              valueId: valId("Engagement Type", "Legacy / Dormant"),
            },
          ],
        },
      ];

      return { categories: cats, defaultSegments };
    };

    return generate();
  })();

  const defaultNamingCategories = (() => {
    // Helper now accepts an array of {id, label} objects instead of just strings
    const makeCat = (id, name, valueObjects) => ({
      id: id,
      name,
      values: valueObjects,
    });

    const individual = makeCat("cat_nc_individual", "Individual", [
      { id: "val_ind_1", label: "{primaryLast}, {primaryFirst}" },
      { id: "val_ind_2", label: "{primaryFirst} {primaryLast}" },
      { id: "val_ind_3", label: "{primaryLast}" }
    ]);

    const jointSame = makeCat("cat_nc_joint_same", "Joint: Same Last", [
      { id: "val_js_1", label: "{sharedLast}, {primaryFirst} & {partnerFirst}" },
      { id: "val_js_2", label: "{sharedLast}, {primaryFirst} & {sharedLast} {partnerFirst}" },
      { id: "val_js_3", label: "{sharedLast}, {primaryFirst} and {partnerFirst}" },
      { id: "val_js_4", label: "{sharedLast}, {primaryFirst} and {sharedLast} {partnerFirst}" },
      { id: "val_js_5", label: "{primaryFirst} & {partnerFirst} {sharedLast}" },
      { id: "val_js_6", label: "{primaryFirst} {sharedLast} & {partnerFirst} {sharedLast}" },
      { id: "val_js_7", label: "{primaryFirst} and {partnerFirst} {sharedLast}" },
      { id: "val_js_8", label: "{primaryFirst} {sharedLast} and {partnerFirst} {sharedLast}" },
      { id: "val_js_9", label: "{sharedLast}" }
    ]);

    const jointDiff = makeCat("cat_nc_joint_diff", "Joint: Different Last", [
      { id: "val_jd_1", label: "{primaryLast}, {primaryFirst} & {partnerLast}, {partnerFirst}" },
      { id: "val_jd_2", label: "{primaryLast}, {primaryFirst} and {partnerLast}, {partnerFirst}" },
      { id: "val_jd_3", label: "{primaryFirst} {primaryLast} & {partnerFirst} {partnerLast}" },
      { id: "val_jd_4", label: "{primaryFirst} {primaryLast} and {partnerFirst} {partnerLast}" },
      { id: "val_jd_5", label: "{primaryLast}-{partnerLast}, {primaryFirst} & {partnerFirst}" },
      { id: "val_jd_6", label: "{primaryLast}-{partnerLast}, {primaryFirst} and {partnerFirst}" },
      { id: "val_jd_7", label: "{primaryLast}-{partnerLast}" }
    ]);

    return [individual, jointSame, jointDiff];
  })();

  const defaultFolderHierarchy = (() => {
    // Investment Mgmt Client Hierarchy
    const clientRootId = uid();
    const clientFolderId = uid();

    const clientNodes = [
      {
        id: clientRootId,
        name: "Clients",
        parentId: null,
        sort: 0,
      },
      {
        id: clientFolderId,
        name: "{Client Name}",
        parentId: clientRootId,
        sort: 0,
      },
      {
        id: uid(),
        name: "01 – Onboarding",
        parentId: clientFolderId,
        sort: 0,
      },
      {
        id: uid(),
        name: "02 – Taxes",
        parentId: clientFolderId,
        sort: 1,
      },
      {
        id: uid(),
        name: "03 – Estate",
        parentId: clientFolderId,
        sort: 2,
      },
      {
        id: uid(),
        name: "04 – Insurance",
        parentId: clientFolderId,
        sort: 3,
      },
    ];

    // Prospect Hierarchy
    const prospectRootId = uid();
    const prospectNameId = uid();

    const prospectNodes = [
      {
        id: prospectRootId,
        name: "Prospects",
        parentId: null,
        sort: 0,
      },
      {
        id: prospectNameId,
        name: "{Prospect Name}",
        parentId: prospectRootId,
        sort: 0,
      },
      {
        id: uid(),
        name: "01 – Inquiry",
        parentId: prospectNameId,
        sort: 0,
      },
      {
        id: uid(),
        name: "02 – Discovery / Data Gathering",
        parentId: prospectNameId,
        sort: 1,
      },
      {
        id: uid(),
        name: "03 – Proposal / Plan Drafts",
        parentId: prospectNameId,
        sort: 2,
      },
      {
        id: uid(),
        name: "04 – Signed Documents",
        parentId: prospectNameId,
        sort: 3,
      },
    ];

    return [
      {
        id: uid(),
        name: "Investment Management Client Folder Hierarchy",
        description:
          "Standard client structure for ongoing investment management relationships.",
        nodes: clientNodes,
      },
      {
        id: uid(),
        name: "Prospect Folder Hierarchy",
        description:
          "Structure for prospects from first inquiry through proposal/signature.",
        nodes: prospectNodes,
      },
    ];
  })();

  // ------------------------------------------------------------
  // STATE - Replace your existing OL.state block with this
  // ------------------------------------------------------------
  OL.state = {
      apps: OL.store.get("apps", defaultApps),
      functions: OL.store.get("functions", defaultFunctions),
      features: OL.store.get("features", defaultFeatures),
      integrations: OL.store.get("integrations", defaultIntegrations),
      resources: OL.store.get("resources", defaultResources),
      datapoints: OL.store.get("datapoints", defaultDatapoints),
      capabilities: OL.store.get("capabilities", defaultCapabilities),
      canonicalCapabilities: OL.store.get("canonicalCapabilities", defaultCanonicalCapabilities),
      teamMembers: OL.store.get("teamMembers", defaultTeamMembers),
      teamRoles: OL.store.get("teamRoles", defaultTeamRoles),
      segmentCategories: OL.store.get("segmentCategories", defaultSegmentCategories.categories),
      segments: OL.store.get("segments", defaultSegmentCategories.defaultSegments),
      folderHierarchy: OL.store.get("folderHierarchy", defaultFolderHierarchy),
      namingCategories: defaultNamingCategories, // Use the hardcoded ones directly for now to force a reset
      namingConventions: OL.store.get("namingConventions", []),
      analyses: OL.store.get("analyses", []),
      analysis: OL.store.get("analysis", {
          apps: [],
          features: [],
          scores: {}
      }),
      workflowStages: OL.store.get("workflowStages", [
          { id: uid(), name: "01 - Prospecting", sortIndex: 0 },
          { id: uid(), name: "02 - Onboarding", sortIndex: 1 },
          { id: uid(), name: "03 - Ongoing Service", sortIndex: 2 }
      ]),
      workflows: OL.store.get("workflows", []), 
  };

  const state = OL.state;

  // normalize legacy resources into richer shape
  (function normalizeResources() {
    const list = Array.isArray(OL.state.resources) ? OL.state.resources : [];
    OL.state.resources = list.map((r) => {
      // legacy style from defaultResources
      const refs = r.references || {};
      return {
        id: r.id || uid(),
        name: r.name || "Untitled Resource",
        type: r.type || "doc", // doc|pdf|form|scheduler|emailTemplate|emailCampaign|zap
        description: r.description || "",
        link: r.link || "",
        appIds: Array.isArray(r.appIds)
          ? r.appIds
          : Array.isArray(refs.apps)
            ? refs.apps.slice()
            : [],
        ownerIds: Array.isArray(r.ownerIds) ? r.ownerIds : [],
        tags: Array.isArray(r.tags) ? r.tags : [],
        resourcesUsed: Array.isArray(r.resourcesUsed) ? r.resourcesUsed : [],
        // NOTE: backlinks (used in) are derived at render-time, not stored
      };
    });
  })();
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

  let capViewMode = "by-app"; // "by-app" or "by-type"
  let currentResourceFilter = "all"; // all|doc|form|scheduler|emailTemplate|emailCampaign|zap

  // ------------------------------------------------------------
  // PERSIST
  // ------------------------------------------------------------
  OL.persist = debounce(() => {
    OL.store.set("apps", state.apps);
    OL.store.set("functions", state.functions);
    OL.store.set("features", state.features);
    OL.store.set("integrations", state.integrations);
    OL.store.set("resources", state.resources);
    OL.store.set("workflowStages", state.workflowStages);
    OL.store.set("workflows", state.workflows);
    OL.store.set("datapoints", state.datapoints);
    OL.store.set("capabilities", state.capabilities);
    OL.store.set("canonicalCapabilities", state.canonicalCapabilities);
    OL.store.set("teamMembers", state.teamMembers);
    OL.store.set("teamRoles", state.teamRoles);
    OL.store.set("segmentCategories", state.segmentCategories);
    OL.store.set("segments", state.segments);
    OL.store.set("folderHierarchy", state.folderHierarchy);
    OL.store.set("namingCategories", state.namingCategories);
    OL.store.set("namingConventions", state.namingConventions);
    OL.store.set("analysis", window.OL.state.analysis);
    OL.store.set("analyses", window.OL.state.analyses);
  }, 200);

  const statusOrder = {
    primary: 0,
    evaluating: 1,
    available: 2,
  };

  function sortByStatusStable(list, getStatus, getStableIndex) {
    return list.slice().sort((a, b) => {
      const sA = statusOrder[normalizeStatus(getStatus(a))] ?? 999;
      const sB = statusOrder[normalizeStatus(getStatus(b))] ?? 999;
      if (sA !== sB) return sA - sB;

      const iA = getStableIndex ? getStableIndex(a) : 0;
      const iB = getStableIndex ? getStableIndex(b) : 0;
      return iA - iB;
    });
  }

  // INITIAL STABLE INDEX SETUP
  state.apps.forEach((a, i) => {
    if (a._stableIndex == null) a._stableIndex = i;
  });

  state.functions.forEach((f, i) => {
    if (f._stableIndex == null) f._stableIndex = i;
  });

  let _fnAppSortTimer = null;

  function delayedSortRenders() {
    clearTimeout(_fnAppSortTimer);
    _fnAppSortTimer = setTimeout(() => {
      // update _stableIndex based on new sorted order
      const sortedApps = [...state.apps].sort((a, b) => {
        const order = { primary: 0, evaluating: 1, available: 2 };
        const sA = order[normalizeStatus(a.status)] ?? 999;
        const sB = order[normalizeStatus(b.status)] ?? 999;
        if (sA !== sB) return sA - sB;
        return (a._stableIndex ?? 0) - (b._stableIndex ?? 0);
      });

      sortedApps.forEach((a, i) => (a._stableIndex = i));

      const sortedFns = [...state.functions].sort((a, b) => {
        const order = { primary: 0, evaluating: 1, available: 2 };
        const sA = order[normalizeStatus(a.status)] ?? 999;
        const sB = order[normalizeStatus(b.status)] ?? 999;
        if (sA !== sB) return sA - sB;
        return (a._stableIndex ?? 0) - (b._stableIndex ?? 0);
      });

      sortedFns.forEach((f, i) => (f._stableIndex = i));

      renderAppsGrid();
      renderFunctionsGrid();
    }, 400);
  }

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

  function findTeamMemberById(id) {
    return (state.teamMembers || []).find((m) => m.id === id) || null;
  }

  function findTeamRoleById(id) {
    return (state.teamRoles || []).find((r) => r.id === id) || null;
  }

  function teamAssignmentsForRole(roleId) {
    const out = [];
    (state.teamMembers || []).forEach((member) => {
      (member.roles || []).forEach((r) => {
        if (r.roleId === roleId) {
          out.push({ member });
        }
      });
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
    // If still draft, do nothing
    if (cap._draft) return;
    if (cap.canonicalId) return;

    // if no canonical assigned, but cap has canonical text
    const existing = findCanonicalByKey(cap.canonical);
    if (existing) {
      cap.canonicalId = existing.id;
      return;
    }
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
    renderTeamMembersGrid();
    renderTeamRolesGrid();
    renderUnifiedSegmentBuilder();
    renderFolderHierarchyGrid();
    renderNamingConventions();
    renderResourcesGrid();
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
      const it = cap.type || "zapier";
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

              /*<a href="#/resources/email-templates" data-route>Email Templates</a>
            <a href="#/resources/forms" data-route>Forms</a>
            <a href="#/resources/scheduling" data-route>Scheduling</a>
            <a href="#/resources/zaps" data-route>Zaps</a>
            <a href="#/resources/email-campaigns" data-route>Email Campaigns</a>
            <a href="#/resources/workflows" data-route>Workflows</a>*/

    root.innerHTML = `
      <div class="app">
        <aside class="sidebar">
          <nav class="menu" id="nav">

            <div class="group-title">Apps</div>
            <a href="#/apps" data-route>Apps</a>
            <a href="#/functions" data-route>Functions</a>
            <a href="#/settings/features" data-route>Features</a>
            <a href="#/analyze" data-route>Analyze</a>
            <div class="divider"></div>

            <div class="group-title">Integrations</div>
            <a href="#/integrations" data-route>Integrations</a>
            <a href="#/triggers-actions" data-route>Triggers & Actions Library</a>
            <a href="#/settings/canonical-capabilities" data-route>Canonical Capabilities</a>
            <div class="divider"></div>
            
            <div class="group-title">Resources</div>
            <a href="#/resources/documents" data-route>Resources</a>
            <a href="#/workflows" data-route>Workflows Visualizer</a>

            <div class="divider"></div>
            <div class="group-title">Settings</div>
            <a href="#/settings/team" data-route>Team</a>
            <a href="#/settings/segments" data-route>Segments</a>
            <a href="#/settings/datapoints" data-route>Datapoints</a>
            <a href="#/settings/folder-hierarchy" data-route>Folder Hierarchy</a>
            <a href="#/settings/naming-conventions" data-route>Naming Conventions</a>
          </nav>
        </aside>

        <main id="mainContent">
          <section class="section" id="section-apps">
              <div class="section-header">
                <h2>Applications</h2>
                <button class="btn small" id="btnAddApp">+ Add Application</button>
              </div>
              <div class="section-controls-bar">
                <div class="spacer"></div>
                <div class="section-actions"></div>
              </div>
              <div id="appsGrid" class="cards-grid"></div>
            </section>

            <section class="section" id="section-functions">
              <div class="section-header">
                <h2>Functions</h2>
                <button class="btn small" id="btnAddFunction">+ Add Function</button>
              </div>
              <div class="pill-key">
                <span class="pill fn status-primary">Primary</span>
                <span class="pill fn status-evaluating">Evaluating</span>
                <span class="pill fn status-available">Available</span>
              </div>
              <div class="pill-key-help">
                  Ctrl+ click a pill to cycle status; right-click to remove the mapping.
              </div>
              <div class="spacer"></div>
              <div class="section-actions"></div>
              <div id="functionsGrid" class="cards-grid"></div>
            </section>

            <section class="section" id="section-features">
              <div class="section-header">
                <h2>Features</h2>
                <button class="btn small" id="btnAddFeature">+ Add Feature</button>
              </div>
              <div id="featuresGrid" class="cards-grid"></div>
            </section>

            <section class="section" id="section-integrations">
              <div class="section-header">
                <h2>Integrations</h2>
                <button class="btn small" id="btnAddIntegration">+ Add Integration</button>
              </div>
              <div class="pill-key">
                <span class="pill integr" data-type="direct">Direct</span>
                <span class="pill integr" data-type="zapier">Zapier</span>
                <span class="pill integr" data-type="both">Both</span>
              </div>
              <div class="pill-key-help">
                Left-click a pill to cycle directionality; right-click to cycle integration type.
              </div>
              <div class="spacer"></div>
              <div class="section-actions"></div>
              <div id="integrationsGrid" class="cards-grid"></div>
            </section>

            <section class="section" id="section-datapoints" style="display: none;">
                <div class="unified-row-layout">
                    <aside class="category-sidebar">
                        <div class="sidebar-header">
                            <h3>Object Types</h3>
                            <button class="btn xsmall soft" id="btnNewDatapointGroup">+ New Type</button>
                        </div>
                        <div id="datapointSidebarList"></div>
                    </aside>

                    <main class="segment-main-content">
                        <div class="section-header">
                            <h2>Datapoint Library</h2>
                            <button class="btn small primary" id="btnAddDatapointGlobal">+ New Datapoint</button>
                        </div>
                        <div id="datapointsGrid" class="cards-grid"></div>
                    </main>
                </div>
            </section>

            <section class="section" id="section-capabilities">
              <div class="section-header">
                <h2>Triggers / Searches / Actions Library</h2>
                <button class="btn small" id="btnAddCapability">+ Add Item</button>
              </div>
              <div class="pill-key">
                <button class="btn xsmall soft" data-capview="by-app">By App</button>
                <button class="btn xsmall soft" data-capview="by-type">By Type</button>
              </div>
              <div class="spacer"></div>
              <div class="section-actions"></div>
              <div id="capabilitiesGrid" class="cards-grid"></div>
            </section>

            <section class="section" id="section-canonical-caps">
              <div class="section-header">
                <h2>Canonical Capabilities</h2>
                <button class="btn small" id="btnAddCanonicalCap">+ Add Canonical Capability</button>
              </div>
              <div class="section-controls-bar">
                <div class="spacer"></div>
                  <div class="section-actions"></div>
                </div>
              <div id="canonicalCapsGrid" class="cards-grid"></div>
            </section>

            <section class="section" id="section-team-members">
              <div class="section-header">
                <h2>Team Members</h2>
                <button class="btn small" id="btnAddTeamMember">+ Add Team Member</button>
              </div>
              <div class="section-controls-bar">
                <div class="spacer"></div>
                <div class="section-actions"></div>
              </div>
              <div id="teamMembersGrid" class="cards-grid"></div>
            </section>

            <section class="section" id="section-team-roles">
              <div class="section-header">
                <h2>Team Roles</h2>
                <button class="btn small" id="btnAddTeamRole">+ Add Role</button>
              </div>
              <div class="section-controls-bar">
                <div class="spacer"></div>
                <div class="section-actions"></div>
              </div>
              <div id="teamRolesGrid" class="cards-grid"></div>
            </section>

           <section class="section" id="section-unified-segments" style="display: none;">
                <aside class="category-sidebar">
                    <div class="sidebar-header">
                        <h3>Logic Categories</h3>
                        <button class="btn xsmall soft" id="btnUnifiedAddCategory">+ New</button>
                    </div>
                    <div id="sidebarCategoryList"></div>
                </aside>

                <div class="segment-main-content">
                    <div class="section-header">
                        <h2>Segment Personas</h2>
                        <button class="btn small" id="btnUnifiedAddPersona">+ New Persona</button>
                    </div>
                    
                    <div id="personaGrid" class="persona-flex-grid"></div>
                </div>
            </section>

            <section class="section" id="section-folder-hierarchy">
              <div class="section-header">
                <h2>Folder Hierarchy</h2>
                <button class="btn small" id="btnAddFolderHierarchy">+ Add Hierarchy</button>
              </div>
              <div class="section-controls-bar">
                <div class="spacer"></div>
                    <div class="section-actions"></div>
                </div>
              <div id="folderHierarchyGrid" class="cards-grid"></div>
            </section>

            <section class="section" id="section-naming-conventions" style="display: none;">
              <div class="section-header">
                <h2>Naming Conventions</h2>
                <div class="header-actions">
                    <button class="btn small" id="btnAddNamingConvention">+ New Scenario</button>
                </div>
              </div>
              
              <div id="namingGrid" class="cards-grid"></div>
            </section>

            <section class="section" id="section-resources">
              <div class="section-header">
                <h2>Resources</h2>
                <button class="btn small" id="btnAddResource">+ Add Resource</button>
              </div>
              <div class="pill-key">
                <button class="btn xsmall soft" data-res-type="all" onclick="OL.setResourceFilter('all')">All</button>
                <button class="btn xsmall soft" data-res-type="doc" onclick="OL.setResourceFilter('doc')">Docs / PDFs</button>
                <button class="btn xsmall soft" data-res-type="form" onclick="OL.setResourceFilter('form')">Forms</button>
                <button class="btn xsmall soft" data-res-type="scheduler" onclick="OL.setResourceFilter('scheduler')">Scheduler</button>
                <button class="btn xsmall soft" data-res-type="emailTemplate" onclick="OL.setResourceFilter('emailTemplate')">Email Templates</button>
                <button class="btn xsmall soft" data-res-type="emailCampaign" onclick="OL.setResourceFilter('emailCampaign')">Email Campaigns</button>
                <button class="btn xsmall soft" data-res-type="zap" onclick="OL.setResourceFilter('zap')">Zaps</button>
              </div>
              <div class="spacer"></div>
              <div class="section-actions"></div>
              <div id="resourcesGrid" class="cards-grid"></div>
            </section>

            <section class="section" id="section-workflows">
                <div class="section-header">
                    <h2>Workflow Visualizer</h2>
                    <div class="section-header-actions">
                        <button class="btn small" onclick="OL.addNewStage()">+ Add New Stage</button>
                    </div>
                </div>
                <div id="workflowsGrid" class="cards-grid">
                    </div>
            </section>

            <section class="section" id="section-analyze">
                <div class="section-header">
                    <h2>Weighted Feature Analysis</h2>
                    <button class="btn small" id="btnAddAppColumn" onclick="openAppColumnDropdown()">
                        + Add Application
                    </button>
                </div>
                <div class="analysis-wrapper">
                    <div class="analysis-left-menu-panel">
                        <div class="analysis-left-menu-header">Functions & Features</div>
                        <div id="analysisFunctionsList" class="analysis-menu-content"></div>
                    </div>
                    <div id="analysisMatrixContainer" class="analysis-matrix-container"></div>
                </div>
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
  OL._handleFnAppPill = function (e, appId, fnId) {
    e.stopPropagation();

    // ctrl/cmd = cycle status
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      OL.cycleFunctionStatus(e, appId, fnId);
      return;
    }

    // otherwise open app modal
    OL.openAppModal(appId);
  };

  OL._handleAppFnPill = function (e, appId, fnId) {
    e.stopPropagation();

    // ctrl/cmd = cycle status
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      OL.cycleFunctionStatus(e, appId, fnId);
      return;
    }

    // otherwise open fn modal
    OL.openFunctionModal(fnId);
  };

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

        const sA = order[normalizeStatus(a.status)] ?? 999;
        const sB = order[normalizeStatus(b.status)] ?? 999;

        if (sA !== sB) return sA - sB;

        const fnA = findFunctionById(a.fnId);
        const fnB = findFunctionById(b.fnId);

        return (fnA?._stableIndex ?? 0) - (fnB?._stableIndex ?? 0);
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
            onclick="event.stopPropagation(); OL.openFunctionModal('${fn.id}')"
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

    // Count datapoints for display
    const dpCount = (app.datapointMappings || []).length;

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
            <div class="card-section-title">Datapoints (${dpCount})</div>
            <div class="card-section-content">
              <div class="pills-row">
                <span class="pill muted">View in modal</span>
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

      const sA = order[normalizeStatus(a.status)] ?? 999;
      const sB = order[normalizeStatus(b.status)] ?? 999;

      if (sA !== sB) return sA - sB;

      // stable tie-breaker
      const fnA = a.app; // here a is a link { app, status }
      const fnB = b.app;

      return (fnA?._stableIndex ?? 0) - (fnB?._stableIndex ?? 0);
    });
    const appPills = links.length
        ? links
            .map((link) => {
                const status = normalizeStatus(link.status);
                return `
                    <span
                        class="pill fn status-${status}"
                        data-app-id="${link.app.id}"
                        
                        onclick="if (event.ctrlKey || event.metaKey) { OL.cycleFunctionStatus(event, '${link.app.id}', '${fn.id}'); } else { event.stopPropagation(); OL.openAppModal('${link.app.id}'); }"
                        
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

 // ========================================================================
// START: CORRECTED ANALYSIS FUNCTIONS BLOCK
// ========================================================================

  // Ensure state structure is correct on boot
  if (!window.OL.state.analyses) window.OL.state.analyses = [];
  if (!window.OL.state.analysis) window.OL.state.analysis = { apps: [], features: [], scores: {} };
  OL.analysisMenuMode = OL.analysisMenuMode || "builder";

  function renderAnalysisMatrix() {
      const data = window.OL.state.analysis; 
      const container = document.getElementById('analysisMatrixContainer');

      if (!container || !data || !data.apps) return; 

      // We will structure the matrix based on features (rows) and apps (columns)
      const features =data.features || [];
      const apps = data.apps || [];
      const totalWeight = features.reduce((sum, f) => sum + (f.weight || 0), 0);

      let matrixHTML = `
        <table class="analysis-matrix">
          <thead>
            <tr>
              <th class="matrix-feature-header">Feature / Function (Total Weight: ${totalWeight}%)</th>
              <th class="matrix-weight-header">Weight</th>
              ${apps.map(app => `
                  <th class="matrix-app-header" data-app-id="${app.appId}">
                      <div class="app-header-content">
                          <div>${OL.iconHTML(findAppById(app.appId) || app)}</div>
                          <div>${OL.utils.esc(app.name)}</div>
                          <div class="app-header-actions">
                              <span class="app-remove-btn"
                                onclick="OL.removeAppColumn('${app.appId}')">×</span>
                          </div>
                      </div>
                  </th>
              `).join('')}
            </tr>
          </thead>
            <tbody>
                ${features.map(f => renderFeatureRow(f, apps)).join('')}
            </tbody>
            <tfoot>
                ${renderAnalysisSummary(apps, features)}
            </tfoot>
        </table>
    `;

      container.innerHTML = matrixHTML;
      OL.wireAnalysisMatrixEvents();
    }

    // Add this function near your other analysis helper functions:
  OL.removeAppColumn = function(appIdToRemove) {
      const data = window.OL.state.analysis;
      data.apps = data.apps.filter(a => a.appId !== appIdToRemove);
      // Clean up scores for the removed app

      Object.keys(data.scores).forEach(featureId => {
          delete data.scores[featureId][appIdToRemove];
      });

      OL.persist();
      OL.renderAnalysisMatrix();
  }

  OL.renderAnalysisMatrix = renderAnalysisMatrix;

  function renderAnalysisSummary(apps, features) {
      const data = window.OL.state.analysis;
      // 1. Calculate the weighted average score for each app (This calculation remains the same)
      const weightedAverages = apps.map(app => {
          let weightedSum = 0;
          let totalWeight = 0;

          features.forEach(f => {
              const score = data.scores[f.id]?.[app.appId] || 0;
              const weight = f.weight || 0;
              weightedSum += score * weight;
              totalWeight += weight;
          });
          const avg = totalWeight > 0 ? (weightedSum / totalWeight).toFixed(2) : 0;
          return { appId: app.appId, name: app.name, score: parseFloat(avg) };
      });

      // 2. Find the winning app
      const winningApp = weightedAverages.sort((a, b) => b.score - a.score)[0];

      // --- CONSOLIDATED AVERAGE ROW ---
      const consolidatedAverageCells = apps.map(app => {
          const avg = weightedAverages.find(a => a.appId === app.appId)?.score.toFixed(2) || '0.00';
          return `<td class="summary-score-cell">${avg}</td>`;
      }).join('');

      let html = `
          <tr class="analysis-summary-row">
              <td>Weighted Average Score</td>
              <td></td> ${consolidatedAverageCells}
          </tr>
      `;

      // --- WINNER ROW ---
      const winnerCell = apps.map(app => {
          const isWinner = winningApp && app.appId === winningApp.appId;
          const winnerScore = isWinner ? winningApp.score.toFixed(2) : '';
          return `
              <td class="summary-winner-cell ${isWinner ? 'winner-highlight' : ''}">
                  ${isWinner ? `WINNER! Score: ${winnerScore}` : ''}
              </td>
          `;
      }).join('');

      html += `
          <tr class="analysis-summary-winner">
              <td colspan="2">Final Recommendation</td>
              ${winnerCell}
          </tr>
      `;
      return html;
  }

  OL.wireAnalysisMatrixEvents = function () {
      // 1. Wire the Add App Column button click handler
      const addAppBtn = document.getElementById('btnAddAppColumn');
      if (addAppBtn) {
          addAppBtn.onclick = () => OL.openAppColumnDropdown();
      }

      const container = document.getElementById('analysisMatrixContainer');
      if (!container) return;

      // 2. Wire Weight Inputs
      container.querySelectorAll('.matrix-weight-input input').forEach(input => {
          input.oninput = (e) => OL.updateFeatureWeight(e.target);
      });

      // 3. Wire Score Inputs
      container.querySelectorAll('.matrix-score-cell input').forEach(input => {
          input.oninput = (e) => OL.updateFeatureScore(e.target);
      });

      // 4. Wire Feature Remove Buttons
      container.querySelectorAll('.remove-feature').forEach(btn => {
          const canonicalId = btn.closest('.matrix-feature-row').getAttribute('data-feature-id');
          btn.onclick = () => OL.removeFeatureFromAnalysis(canonicalId);
      });
  }

  function renderFeatureRow(feature, apps) {
      const data = window.OL.state.analysis;
      const currentWeight = feature.weight || 0;
      let scoreCells = apps.map(app => {

          // CRITICAL: Use feature.id instead of canonicalId for score lookup
          const score = data.scores[feature.id]?.[app.appId] || '';

          return `
              <td class="matrix-score-cell">
                  <input type="number"
                          data-feature-id="${feature.id}"
                          data-app-id="${app.appId}"
                          value="${score}"
                          min="1" max="5"
                          placeholder="Score (1-5)"
                          oninput="OL.updateFeatureScore(this)"
                  />
              </td>
          `;
      }).join('');

      return `
          <tr class="matrix-feature-row" data-feature-id="${feature.id}">
              <td class="matrix-feature-name">
                  ${OL.utils.esc(feature.name)}
                  <span class="remove-feature" onclick="OL.removeFeatureFromAnalysis('${feature.id}')">×</span>
              </td>
              <td class="matrix-weight-input">
                  <input type="number"
                          data-feature-id="${feature.id}"
                          value="${currentWeight}"
                          min="0" max="100"
                          placeholder="Weight"
                          oninput="OL.updateFeatureWeight(this)"
                  />
              </td>
              ${scoreCells}
          </tr>
      `;
  }

  OL.updateFeatureScore = function (inputElement) {
      const data = window.OL.state.analysis;
      const featureId = inputElement.getAttribute('data-feature-id');
      const appId = inputElement.getAttribute('data-app-id');
      const newScore = parseFloat(inputElement.value) || 0;

      // Ensure score is within a sensible range (e.g., 1-5)
      const sanitizedScore = Math.max(1, Math.min(5, newScore));
      inputElement.value = sanitizedScore;
      data.scores[featureId] = data.scores[featureId] || {};
      data.scores[featureId][appId] = sanitizedScore;

      OL.persist();
      // Re-render the matrix to update the summary/weighted average score
      OL.renderAnalysisMatrix();
  }

  OL.openAppColumnDropdown = function() {
      const data = window.OL.state.analysis;
      const anchorEl = document.getElementById('btnAddAppColumn');

      if (!anchorEl) return;

      // 1. Identify which apps are already in the analysis
      const existingAppIds = new Set(data.apps.map(a => a.appId));

      // 2. Filter all available apps based on inclusion in the analysis

      const options = state.apps
          .filter(Boolean)
          .map((app) => ({
              id: app.id,
              label: app.name,
              checked: existingAppIds.has(app.id),
          }))
          .sort((a, b) => a.label.localeCompare(b.label));

      openMappingDropdown({
          anchorEl: anchorEl,
          options: options,
          allowMultiple: true, // Allow multiple apps to be selected/deselected
          onSelect: (appId, isChecked) => {

              const app = findAppById(appId);
              if (!app) return;

              if (isChecked) {
                  // Add the app to the analysis apps array
                  if (!existingAppIds.has(appId)) {
                      data.apps.push({
                          appId: app.id,
                          name: app.name // Include name/icon for simpler rendering
                      });
                  }
              } else {
                  // Remove the app from the analysis apps array
                  data.apps = data.apps.filter(a => a.appId !== appId);

                  // Clean up any scores associated with the removed app (optional, but clean)

                  Object.keys(data.scores).forEach(featureId => {
                      delete data.scores[featureId][appId];
                  });
              }

              OL.persist();
              OL.renderAnalysisMatrix(); // Re-render the matrix with the new columns

              // Re-render handled by the call inside renderAnalysisMatrix, but necessary for dropdown refresh
              const dd = document.querySelector(".mapping-dropdown");
              if (dd && dd.refresh) dd.refresh();
          },
      });
  }

  // Helper to retrieve a feature by its ID (Required for all subsequent functions)
  function findFeatureById(id) {
      return (state.features || []).find(f => f.id === id) || null;
  }

// 1. Adds a single feature row to the analysis matrix
OL.addFeatureToAnalysis = function (featureId) {
    const feature = findFeatureById(featureId);
    const data = window.OL.state.analysis;
    if (!feature || data.features.some(f => f.id === featureId)) return;
    // --- Auto-weight logic (remains the same as fixed earlier) ---
    const currentFeatureCount = data.features.length;
    const equalWeight = Math.round(100 / (currentFeatureCount + 1));
    
    data.features.forEach(f => {f.weight = equalWeight;});

    const newFeature = {
        id: feature.id,
        name: feature.name,
        functionId: feature.functionId || null,
        category: feature.category || null,
        weight: equalWeight,
    };
    
    data.features.push(newFeature);
    
    const totalCurrentWeight = data.features.reduce((sum, f) => sum + f.weight, 0);
    if (totalCurrentWeight !== 100 && data.features.length > 0) {
        data.features[0].weight += (100 - totalCurrentWeight);
    }
    
    OL.persist();
    OL.renderAnalysisMatrix();
}


// 2a. Adds all features related to a function
OL.addFeaturesByFunction = function (functionId) {
    state.features
        .filter(f => f.functionId === functionId) 
        .forEach(feature => {
            OL.addFeatureToAnalysis(feature.id);
        });
}

// 2b. Adds all features related to a category (uses category string)
OL.addFeaturesByCategory = function (category) {
    // Note: Category ID passed from HTML is lowercase and stripped of spaces (e.g., 'general')
    // We filter against the category property on the Feature object, which is the full string (e.g., 'General')
    state.features
        .filter(f => f.category && f.category.toLowerCase().replace(/\s/g, '') === category) 
        .forEach(feature => {
            OL.addFeatureToAnalysis(feature.id);
        });
}

// 3. Removes a feature row from the analysis matrix
OL.removeFeatureFromAnalysis = function (featureId) {
    const data = window.OL.state.analysis;
    data.features = data.features.filter(f => f.id !== featureId);
    delete data.scores[featureId];

    const remainingFeatures = data.features.length;
    if (remainingFeatures > 0) {
        const newEqualWeight = Math.round(100 / remainingFeatures);
        
        data.features.forEach(f => {
            f.weight = newEqualWeight;
        });
        
        const totalWeight = data.features.reduce((sum, f) => sum + f.weight, 0);
        if (totalWeight !== 100) {
            data.features[0].weight += (100 - totalWeight);
        }
    }
    
    OL.persist();
    OL.renderAnalysisMatrix();
}

// 4. Update Inputs (Exposed directly to OL)
OL.updateFeatureWeight = function (inputElement) {
    const data = window.OL.state.analysis;
    const featureId = inputElement.getAttribute('data-feature-id');
    let newWeight = parseInt(inputElement.value) || 0;

    const feature = data.features.find(f => f.id === featureId); // data must be defined early
    if (feature) {
        feature.weight = Math.max(0, Math.min(100, newWeight));
        inputElement.value = feature.weight; 
        OL._debouncedUpdateMatrix(); 
    }
}

  // Add to state initialization
  OL.state.analyses = OL.store.get("analyses", []);
  // A temporary flag to track which view we are in
  OL.analysisMenuMode = "builder"; // "builder" or "library"

// 4. Left Menu Renderer (THIS IS THE FUNCTION THAT MUST OVERWRITE THE OLD ONE)
function renderAnalysisLeftMenu() {
    const fnList = document.getElementById('analysisFunctionsList');
    if (!fnList) return;

    const analyses = window.OL.state.analyses || [];
    
    // 1. Render the persistent Header (Save Button and Toggle)
    let html = `
        <div class="analysis-menu-header" style="padding:10px; border-bottom:1px solid var(--line); margin-bottom:10px;">
            <button class="btn primary full-width" onclick="OL.saveCurrentAnalysis()" style="margin-bottom:10px; width: 100%;">
                💾 Save Current Snapshot
            </button>
            <div class="toggle-bar" style="display:flex; background:rgba(0,0,0,0.2); border-radius:4px; padding:2px;">
                <button class="btn xsmall ${OL.analysisMenuMode === 'builder' ? 'active' : 'soft'}" 
                        style="flex:1;" onclick="OL.setAnalysisMenuMode('builder')">Builder</button>
                <button class="btn xsmall ${OL.analysisMenuMode === 'library' ? 'active' : 'soft'}" 
                        style="flex:1;" onclick="OL.setAnalysisMenuMode('library')">Library (${analyses.length})</button>
            </div>
        </div>
    `;

    // 2. Conditional Body Rendering
    if (OL.analysisMenuMode === "library") {
        // --- LIBRARY MODE ---
        html += `<div class="analysis-library-list" style="padding:10px;">`;
        if (analyses.length === 0) {
            html += `<div class="empty-hint">No saved analyses yet.</div>`;
        } else {
            analyses.forEach(anly => {
                html += `
                  <div class="sidebar-item saved-file-row" 
                    style="display:flex; justify-content:space-between; align-items:center; padding:8px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05);"
                    onclick="OL.loadSavedAnalysis('${anly.id}')">
                    <div style="flex:1; overflow:hidden;">
                        <div class="sidebar-item-title" style="font-size:13px; display:flex; align-items:center; gap:6px;">
                            📄 <span class="anly-name-text">${OL.utils.esc(anly.name)}</span>
                        </div>
                        <div class="sidebar-item-meta" style="font-size:10px; opacity:0.5;">${new Date(anly.date).toLocaleDateString()}</div>
                    </div>
                    
                    <div style="display:flex; gap:8px; align-items:center;">
                        <span onclick="event.stopPropagation(); OL.renameSavedAnalysis('${anly.id}')" title="Rename">✏️</span>
                        <span onclick="event.stopPropagation(); OL.cloneSavedAnalysis('${anly.id}')" title="Clone/Duplicate">👯</span>
                        <span class="card-close" onclick="event.stopPropagation(); OL.deleteSavedAnalysis('${anly.id}')" style="font-size:16px;">×</span>
                    </div>
                </div>
                `;
            });
        }
        html += `</div>`;
    } else {
        // --- BUILDER MODE ---
        const sortedFunctions = [...state.functions].sort((a, b) => 
            (a.name || '').localeCompare(b.name || '')
        );
        const specialCategories = ["General", "Security", "Integration"];

        // Group by Function
        sortedFunctions.forEach(fn => {
            const fnFeatures = (state.features || []).filter(f => f.functionId === fn.id);
            html += `
                <div class="analysis-fn-group">
                    <div class="analysis-fn-name">${OL.utils.esc(fn.name || '(Unnamed Function)')}</div>
                    <div class="analysis-fn-features-label">(${fnFeatures.length} Features)</div>
                </div>
                <div class="analysis-feature-list" id="list-fn-${fn.id}">
            `;
            fnFeatures.forEach(feature => {
                html += `
                    <div class="analysis-feature-row" data-feature-id="${feature.id}"> 
                        <div class="analysis-feature-add-icon" 
                          onclick="OL.addFeatureToAnalysis('${feature.id}')"
                          title="Add to Matrix">→</div>

                        <div class="analysis-feature-name" 
                          contenteditable="true" 
                          onblur="OL.renameFeatureInline(this, '${feature.id}')" 
                          onkeydown="OL.handleFeatureRenameKey(event)">
                          ${OL.utils.esc(feature.name)}
                        </div>

                        <span class="analysis-feature-delete" 
                          onclick="OL.removeFeatureInline(event, '${feature.id}')">×</span>
                    </div>
                `;
            });
            html += `
                    <div class="analysis-feature-add-btn" onclick="OL.quickAddFeatureToFunction(event, '${fn.id}')">
                        + Add Feature
                    </div>
                </div>
            `;
        });

        // Fixed Categories (General, Security, etc)
        specialCategories.forEach(category => {
            const catFeatures = (state.features || []).filter(f => f.category === category);
            if (catFeatures.length > 0) {
                const categoryId = category.toLowerCase().replace(/\s/g, '');
                html += `
                    <div class="analysis-fn-group clickable" onclick="OL.addFeaturesByCategory('${categoryId}')">
                        <div class="analysis-fn-name">${category} Features</div>
                    </div>
                    <div class="analysis-feature-list">
                        ${catFeatures.map(f => `
                            <div class="analysis-feature-row clickable" onclick="OL.addFeatureToAnalysis('${f.id}')">
                                ${OL.utils.esc(f.name)}
                            </div>
                        `).join('')}
                    </div>
                `;
            }
        });

        // Unassigned Features
        const unassigned = (state.features || []).filter(f => !f.functionId && !f.category);
        if (unassigned.length > 0) {
            html += `
                <div class="analysis-fn-group unassigned" style="background:#402020; color:white;">
                    <div class="analysis-fn-name">UNASSIGNED</div>
                </div>
                <div class="analysis-feature-list">
                    ${unassigned.map(f => `
                        <div class="analysis-feature-row clickable" onclick="OL.addFeatureToAnalysis('${f.id}')">
                            ${OL.utils.esc(f.name)}
                        </div>
                    `).join('')}
                </div>
            `;
        }
    }
    fnList.innerHTML = html;
}
OL.renderAnalysisLeftMenu = renderAnalysisLeftMenu;

OL.renameSavedAnalysis = function(id) {
    // 1. Find the snapshot in the library
    const saved = window.OL.state.analyses.find(a => a.id === id);
    if (!saved) return;

    // 2. Prompt for new name
    const newName = prompt("Rename snapshot:", saved.name);
    
    // 3. Update and persist
    if (newName && newName.trim() && newName !== saved.name) {
        saved.name = newName.trim();
        OL.persist();
        
        // 4. Refresh the menu to show the change
        OL.renderAnalysisLeftMenu();
    }
};

OL.cloneSavedAnalysis = function(id) {
    const original = window.OL.state.analyses.find(a => a.id === id);
    if (!original) return;

    // Create a new object that is a copy of the original
    const clone = {
        id: 'anly-' + Date.now(),
        name: original.name + " (Copy)",
        date: new Date().toISOString(),
        // Deep clone the grid data so they remain independent
        gridData: JSON.parse(JSON.stringify(original.gridData))
    };

    window.OL.state.analyses.unshift(clone);
    OL.persist();
    OL.renderAnalysisLeftMenu(); // Refresh the sidebar
    alert(`Cloned "${original.name}"`);
};

OL.setAnalysisMenuMode = (mode) => { 
  OL.analysisMenuMode = mode; 
  renderAnalysisLeftMenu(); 
};

OL.saveCurrentAnalysis = function() {
    // Force the browser to look at the current live state
    const data = window.OL.state.analysis;

    if (!data || !Array.isArray(data.apps)) {
        console.error("Save Error: Analysis data structure is invalid.", currentData);
        alert("Error: Analysis data not found. Try adding an app or feature first.");
        return;
    }

    const name = prompt("Name this analysis snapshot:", `Analysis ${new Date().toLocaleDateString()}`);
    if (!name || !name.trim()) return;

    // Create the Snapshot
    const snapshot = {
        id: 'anly-' + Date.now(),
        name: name.trim(),
        date: new Date().toISOString(),
        // Deep clone the object so the save is "frozen"
        gridData: JSON.parse(JSON.stringify(data)) 
    };

    // Push to library
    if (!Array.isArray(window.OL.state.analyses)) window.OL.state.analyses = [];
    window.OL.state.analyses.unshift(snapshot);
    
    // Save to LocalStorage and flip the UI
    OL.persist();
    OL.analysisMenuMode = "library";
    OL.renderAnalysisLeftMenu();
    alert(`Snapshot "${name}" saved to library!`);
};

OL.loadSavedAnalysis = function(id) {
    const saved = state.analyses.find(a => a.id === id);
    if (!saved) return;

    if (confirm(`Load "${saved.name}"? This will replace your current working grid.`)) {
        // Replace the active sandbox with the saved snapshot
        window.OL.state.analysis = JSON.parse(JSON.stringify(saved.gridData));
        OL.persist();
        OL.renderAnalysisMatrix();
        OL.analysisMenuMode = "builder";
        renderAnalysisLeftMenu();
    }
};

OL.deleteSavedAnalysis = function(id) {
    if (!confirm("Delete this saved analysis permanently?")) return;
    state.analyses = state.analyses.filter(a => a.id !== id);
    OL.persist();
    OL.renderAnalysisLeftMenu();
};

OL.quickAddFeatureToFunction = function(e, functionId) {
    e.stopPropagation(); // Prevent triggering parent group clicks

    const featureName = prompt("Enter new feature name:");
    if (!featureName || !featureName.trim()) return;

    // 1. Create the feature object
    const newFeature = {
        id: OL.utils.uid(),
        functionId: functionId,
        name: featureName.trim(),
        description: "",
        datapoints: []
    };

    // 2. Add to global state
    if (!Array.isArray(state.features)) state.features = [];
    state.features.push(newFeature);

    // 3. Save and Refresh
    OL.persist();
    renderAnalysisLeftMenu(); // Refresh the menu to show the new item
};

// 1. Rename Logic
OL.renameFeatureInline = function(el, featureId) {
    const newName = el.textContent.trim();
    if (!newName) {
        // If empty, revert to old state or a default
        renderAnalysisLeftMenu();
        return;
    }

    const feat = state.features.find(f => f.id === featureId);
    if (feat) {
        feat.name = newName;
        OL.persist();
        // No need to re-render the whole menu unless you want to resort alphabetical
    }
};

// 2. Key Handling (Enter to Save)
OL.handleFeatureRenameKey = function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur(); // Triggers the onblur rename logic
    }
};

// 3. Remove Logic
OL.removeFeatureInline = function(e, featureId) {
    e.stopPropagation(); // Don't trigger the 'add to analysis' click
    
    if (!confirm("Are you sure you want to delete this feature?")) return;

    state.features = state.features.filter(f => f.id !== featureId);
    OL.persist();
    renderAnalysisLeftMenu(); // Must re-render to remove the row
};

  // ------------------------------------------------------------
  // WORKFLOW HELPERS (Global Scope)
  // ------------------------------------------------------------
  function findWorkflowById(id) {
      return (OL.state.workflows || []).find(w => w.id === id) || null;
  }

  function findWorkflowStageById(id) {
      return (OL.state.workflowStages || []).find(s => s.id === id) || null;
  }

  // Ensure the global OL object also has access if needed from HTML attributes
  OL.findWorkflowById = findWorkflowById;
  //--------------------------------------------------------
  // WORKFLOW VISUALIZER GRID
  //--------------------------------------------------------
  
  function renderWorkflowsGrid() {
      const grid = document.getElementById("workflowsGrid");
      if (!grid) return;

      const stages = [...state.workflowStages].sort((a, b) => a.sortIndex - b.sortIndex);
      
      if (!stages.length) {
          grid.innerHTML = `<div class="empty-hint">No Stages defined. Click "+ Add New Stage" above to begin.</div>`;
          return;
      }

      // Map through stages to create vertical columns/blocks
      grid.innerHTML = stages.map(stage => {
      const workflowsInStage = (state.workflows || []).filter(w => w.stageId === stage.id);
      // Inside renderWorkflowsGrid map function:
      return `
          <div class="workflow-stage-block" data-stage-id="${stage.id}">
              <div class="stage-block-header">
                  <div class="stage-drag-handle" draggable="true" title="Drag to reorder stages">⠿</div>
                  
                  <h3 class="stage-block-title">${esc(stage.name)}</h3>
                  <div class="stage-block-actions">
                      <button class="btn xsmall soft" onclick="OL.addNewWorkflowToStage('${stage.id}')">+</button>
                      <button class="btn xsmall soft warn" onclick="OL.deleteStage('${stage.id}')">×</button>
                  </div>
              </div>
              <div class="process-list">
                  ${workflowsInStage.length > 0 ? 
                      workflowsInStage.map(w => `
                      <div class="process-street-row" data-workflow-id="${w.id}">
                              <div class="handle-container">
                                  <div class="workflow-drag-handle" draggable="true">⠿</div>
                              </div>
                              
                              <div class="process-info" onclick="event.stopPropagation(); OL.openWorkflowVisualizer('${w.id}')">
                                  <div class="process-name">${esc(w.name)}</div>
                                  <div class="process-meta">${(w.nodes || []).length} steps</div>
                              </div>
                              
                              <div class="actions-container">
                                  <button class="card-close" onclick="event.stopPropagation(); OL.deleteWorkflow('${w.id}')">×</button>
                              </div>
                          </div>
                      `).join(''): 
                      '<div class="empty-hint">No workflows</div>'
                  }
              </div>
          </div>
      `;
          }).join('');
      setTimeout(() => {
        wireStageDragAndDrop();    // Horizontal Stage reordering
        wireWorkflowDragAndDrop(); // Vertical Workflow reordering
    }, 0);
  }
  
  OL.renderWorkflowsGrid = renderWorkflowsGrid; 
  // OR (if you call it without the OL prefix in HTML):
  window.renderWorkflowsGrid = renderWorkflowsGrid;
  
  OL.addNewStage = function() {
      const name = prompt("Enter Stage Name (e.g. 01 - Discovery):");
      if (!name) return;
      const newStage = { id: uid(), name, sortIndex: state.workflowStages.length };
      state.workflowStages.push(newStage);
      OL.persist();
      renderWorkflowsGrid();
  };

  OL.addNewWorkflowToStage = function(stageId) {
      const name = prompt("Enter Workflow Name:");
      if (!name) return;
      const newWorkflow = {
          id: uid(),
          stageId: stageId,
          name,
          description: "",
          nodes: []
      };
      state.workflows.push(newWorkflow);
      OL.persist();
      renderWorkflowsGrid();
  };

  OL.handleWorkflowClick = function(element) {
    console.log("--- Click Detected ---"); // If you don't see this, the HTML is broken
    
    // Check if the global state is accessible
    if (typeof OL === 'undefined' || !OL.state) {
        console.error("OL state is missing!");
        return;
    }

    const row = element.closest('.process-street-row');
    const workflowId = row ? row.getAttribute('data-workflow-id') : null;

    console.log("Extracted ID:", workflowId);

    if (workflowId) {
        // Try calling the function directly
        try {
            OL.openWorkflowVisualizer(workflowId);
        } catch (e) {
            console.error("Visualizer failed to open:", e.message);
        }
    }
}

  function wireStageDragAndDrop() {
    const grid = document.getElementById("workflowsGrid");
    const handles = grid.querySelectorAll(".stage-drag-handle");

    handles.forEach(handle => {
        const block = handle.closest(".workflow-stage-block");

        handle.ondragstart = (e) => {
            e.dataTransfer.setData("type", "stage");
            e.dataTransfer.setData("id", block.dataset.stageId);
            block.classList.add("dragging-stage");
            // Improves the "ghost" image to show the whole block
            e.dataTransfer.setDragImage(block, 20, 20); 
        };

        handle.ondragend = () => {
            block.classList.remove("dragging-stage");
            grid.querySelectorAll(".workflow-stage-block").forEach(b => b.classList.remove("stage-drop-zone"));
        };
    });

    // Grid-level drop logic remains the same
    grid.querySelectorAll(".workflow-stage-block").forEach(block => {
        block.ondragover = (e) => {
            if (grid.querySelector(".dragging-workflow")) return;
            e.preventDefault();
            block.classList.add("stage-drop-zone");
        };
        block.ondragleave = () => block.classList.remove("stage-drop-zone");
        // Inside wireStageDragAndDrop -> block.ondrop:
        block.ondrop = (e) => {
            e.preventDefault();
            const type = e.dataTransfer.getData("type");
            const draggedId = e.dataTransfer.getData("id");
            
            if (type === "stage" && draggedId !== block.dataset.stageId) {
                const stages = OL.state.workflowStages;
                const fromIdx = stages.findIndex(s => s.id === draggedId);
                const toIdx = stages.findIndex(s => s.id === block.dataset.stageId);
                
                const [removed] = stages.splice(fromIdx, 1);
                stages.splice(toIdx, 0, removed);
                
                // 1. Update sortIndex
                stages.forEach((s, i) => s.sortIndex = i);
                
                // 2. NEW: Renumber the text prefixes
                autoRenumberStages();
                
                OL.persist();
                renderWorkflowsGrid(); // Refresh to show the new names
            }
        };
    });
}

function wireWorkflowDragAndDrop() {
    const grid = document.getElementById("workflowsGrid");
    if (!grid) return;

    // 1. SETUP CLICKS (Delegation)
    // We attach one listener to the parent. It catches clicks on the 'process-info'
    // but ignores the 'workflow-drag-handle'.
    grid.onclick = (e) => {
        const infoArea = e.target.closest(".process-info");
        if (infoArea) {
            e.preventDefault();
            e.stopPropagation();
            const row = infoArea.closest(".process-street-row");
            const workflowId = row.dataset.workflowId;
            console.log("Opening visualizer for:", workflowId);
            OL.openWorkflowVisualizer(workflowId);
        }
    };

    // 2. SETUP DRAG HANDLES (Your existing logic, slightly hardened)
    const handles = grid.querySelectorAll(".workflow-drag-handle");
    const lists = grid.querySelectorAll(".process-list");

    handles.forEach(handle => {
        const row = handle.closest(".process-street-row");
        handle.setAttribute("draggable", "true");

        handle.ondragstart = (e) => {
            e.stopPropagation(); 
            e.dataTransfer.setData("application/json", JSON.stringify({
                type: "workflow",
                id: row.dataset.workflowId
            }));
            row.classList.add("dragging-workflow");
            
            // Set the ghost image to the whole row so it looks like Trello/Process Street
            if (e.dataTransfer.setDragImage) {
                e.dataTransfer.setDragImage(row, 20, 20);
            }
        };

        handle.ondragend = () => {
            row.classList.remove("dragging-workflow");
            grid.querySelectorAll(".drag-over-list").forEach(el => el.classList.remove("drag-over-list"));
        };
    });

    // 3. SETUP DROP ZONES
    lists.forEach(list => {
        list.ondragover = (e) => {
            const draggingRow = document.querySelector(".dragging-workflow");
            if (!draggingRow) return;

            e.preventDefault(); 
            e.stopPropagation();
            list.classList.add("drag-over-list");

            const afterElement = getDragAfterElement(list, e.clientY);
            if (afterElement == null) {
                list.appendChild(draggingRow);
            } else {
                list.insertBefore(draggingRow, afterElement);
            }
        };

        list.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            list.classList.remove("drag-over-list");

            try {
                const data = JSON.parse(e.dataTransfer.getData("application/json"));
                if (data.type !== "workflow") return;

                const targetStageId = list.closest(".workflow-stage-block").dataset.stageId;
                const workflow = OL.state.workflows.find(w => w.id === data.id);
                
                if (workflow) {
                    workflow.stageId = targetStageId;
                    const newOrder = [];
                    document.querySelectorAll(".process-street-row").forEach(r => {
                        const found = OL.state.workflows.find(w => w.id === r.dataset.workflowId);
                        if (found) newOrder.push(found);
                    });
                    OL.state.workflows = newOrder;
                    OL.persist();
                    renderWorkflowsGrid(); 
                }
            } catch (err) { console.error("Drop error:", err); }
        };
    });
}
  function renderProcessStreetItem(process) {
      const stepCount = (process.nodes || []).length;
      return `
          <div class="process-street-row" onclick="OL.openWorkflowVisualizer('${process.id}')">
              <div class="process-icon">📋</div>
              <div class="process-info">
                  <div class="process-name">${esc(process.name)}</div>
                  <div class="process-meta">${stepCount} steps • ${esc(process.description || 'No description')}</div>
              </div>
              <div class="process-actions">
                  <button class="card-close" onclick="event.stopPropagation(); OL.deleteWorkflow('${process.id}')">×</button>
              </div>
          </div>
      `;
  }

    OL.openWorkflowVisualizer = function(workflowId) {
      // Now findWorkflowById is available globally in this script
      const workflow = findWorkflowById(workflowId);
      
      if (!workflow) {
          console.error("Workflow not found:", workflowId);
          return;
      }
      OL.activeWorkflowId = workflowId;

      // 1. Render the Process Street style layout
      openModal(renderVisualizerLayout(workflow));

      // 2. Bind the Drag & Drop and Edit events
      setTimeout(() => {
          // Ensure this function exists in your script
          if (typeof bindVisualizerUI === 'function') {
              bindVisualizerUI(workflow);
          } else {
              // Fallback: wire basics if full binder isn't found
              wireWorkflowDragAndDrop(workflow.id);
          }
      }, 0);
  };
  // -------------------------------------------------------------
  // WORKFLOW MODAL IMPLEMENTATION
  // -------------------------------------------------------------

  /**
   * Renders the initial modal content for creating/editing a Workflow.
   */
  function renderWorkflowModalHTML(workflow) {
      return `
          <div class="modal-head">
              <div id="workflowName"
                  class="modal-title-text"
                  contenteditable="true"
                  data-placeholder="New Workflow Name">
                  ${esc(workflow.name || "")}
              </div>
              <div class="spacer"></div>
              <button class="btn small soft" onclick="OL.returnToVisualizer('${workflow.id}')">Close</button>
          </div>
          <div class="modal-body">
              <div>
                  <label class="modal-section-label">Description</label>
                  <textarea id="workflowDesc" class="modal-textarea">${esc(workflow.description || "")}</textarea>
              </div>
              
              <div class="modal-section-info muted" style="margin-top: 15px;">
                  Save the name and description first, then you can click the button below to open the full visualizer.
              </div>
              
              ${!workflow._draft ? 
                  `<button class="btn large" id="btnOpenVisualizer" style="margin-top: 20px;">Open Workflow Visualizer »</button>`
                  : `<div class="empty-hint" style="margin-top: 20px;">Save the workflow name to enable the visualizer.</div>`
              }
          </div>
      `;
  }

  /**
   * Binds events for the Workflow Modal.
   */
  OL.openWorkflowModal = function(workflowOrId, isNew = false) {
      let workflow = typeof workflowOrId === "string" 
          ? findWorkflowById(workflowOrId) 
          : workflowOrId;
      
      if (!workflow) return;

      activeOnClose = null;
      openModal(renderWorkflowModalHTML(workflow, isNew));
      setTimeout(() => bindWorkflowModal(workflow, isNew), 0);
  };

  function bindWorkflowModal(workflow, isNew) {
      const layer = getModalLayer();
      if (!layer) return;

      let created = !workflow._draft;

      const nameEl = layer.querySelector("#workflowName");
      const descEl = layer.querySelector("#workflowDesc");
      const openVisualizerBtn = layer.querySelector("#btnOpenVisualizer");

      // --- Commit Logic (Handles Draft -> Saved Transition) ---
      function commitIfNeeded(val) {
          if (created || !val) return;
          created = true;
          delete workflow._draft;
          state.workflows.push(workflow); // Commit to state
          OL.persist();
          renderWorkflowsGrid();
          
          // Re-open the modal to show the enabled Visualizer button
          OL.openWorkflowModal(workflow.id); 
      }
      
      // --- Placeholder Logic (Reused from other modals) ---
      function updatePlaceholder(el) {
          el.dataset.empty = el.textContent.trim() === "" ? "true" : "false";
      }

      // --- Name Field Binding (ContentEditable) ---
      if (nameEl) {
          if (isNew) nameEl.textContent = "";

          nameEl.addEventListener("input", () => updatePlaceholder(nameEl));
          requestAnimationFrame(() => updatePlaceholder(nameEl));

          nameEl.addEventListener("blur", () => {
              const v = (nameEl.textContent || "").trim();
              
              commitIfNeeded(v);
              
              workflow.name = v;
              OL.persist();
              renderWorkflowsGrid();
          });
      }

      // --- Description Field Binding (Textarea) ---
      if (descEl) {
          descEl.addEventListener(
              "input",
              debounce(() => {
                  commitIfNeeded(workflow.name); // Commit draft if description is typed first
                  workflow.description = descEl.value;
                  OL.persist();
                  renderWorkflowsGrid();
              }, 200),
          );
      }
      
      // --- Open Visualizer Button (Only visible if not a draft) ---
      if (openVisualizerBtn) {
          openVisualizerBtn.onclick = (e) => {
              e.stopPropagation();
              OL.closeModal();
              OL.openWorkflowVisualizer(workflow.id);
          };
      }
  }

  // -------------------------------------------------------------
  // WORKFLOW ACTIONS (Initial stubs)
  // -------------------------------------------------------------

  OL.deleteWorkflow = function(id) {
      const w = findWorkflowById(id);
      if (!w) return;
      if (!confirm(`Delete workflow "${w.name}"? This cannot be undone.`)) return;

      state.workflows = state.workflows.filter(x => x.id !== id);
      OL.persist();
      renderWorkflowsGrid();
  };
  OL.saveWorkflow = function(workflowId) {
    // We already persist all changes via bindings, so this just closes the view.
    OL.persist();
    OL.closeModal();
    renderWorkflowsGrid();
  };

  /**
   * Renders the main workflow visualizer interface.
   * Note: This function will eventually replace the simple alert inside bindWorkflowModal.
   */
  OL.openVisualizerScreen = function(workflowId) {
      const workflow = findWorkflowById(workflowId);
      if (!workflow) {
          alert("Error: Workflow not found.");
          return;
      }

      // 1. Create a dynamic page structure (using the modal system for convenience)
      openModal(renderVisualizerLayout(workflow));

      // 2. Bind the UI elements
      setTimeout(() => bindVisualizerUI(workflow), 0);
  };

  function renderVisualizerLayout(workflow) {
      // 1. Identify all unique owners assigned to steps in this workflow
      const assignedOwnerIds = new Set();
      (workflow.nodes || []).forEach(n => {
          const ids = n.ownerIds || (n.ownerId ? [n.ownerId] : []);
          ids.forEach(id => assignedOwnerIds.add(id));
      });

      const activeOwners = Array.from(assignedOwnerIds)
          .map(id => findTeamMemberById(id))
          .filter(Boolean);

      // 2. Generate Filter HTML
      const filterHTML = activeOwners.map(m => `
          <div class="owner-filter-pill" onclick="OL.toggleOwnerFilter('${workflow.id}', '${m.id}', this)">
              ${OL.utils.getInitials(m.name)}
          </div>
      `).join('');

      return `
          <div class="modal-head visualizer-head">
              <div class="modal-title-text">${esc(workflow.name)}</div>
              <div class="spacer"></div>
              <button class="btn small soft" onclick="OL.openWorkflowModal('${workflow.id}', false)">Settings</button>
              <button class="btn small primary" onclick="OL.closeModal(); renderWorkflowsGrid();">Save & Exit</button>
          </div>

          <div class="visualizer-filter-bar">
              <span class="small muted">Filter by Owner:</span>
              <div class="owner-filter-list">
                  <div class="owner-filter-pill active" onclick="OL.toggleOwnerFilter('${workflow.id}', 'all', this)">All</div>
                  ${filterHTML}
              </div>
          </div>

          <div class="modal-body visualizer-list-body">
              <div id="visualizerStepsList" class="visualizer-vertical-list">
                  ${renderStagesAndNodes(workflow)}
                  <div class="ps-add-controls">
                      <button class="btn small soft btn-add-node" data-workflow-id="${workflow.id}">+ Add Step or Resource</button>
                  </div>
              </div>
          </div>
      `;
  }

  OL.toggleOwnerFilter = function(workflowId, ownerId, el) {
    const list = document.querySelector('.visualizer-vertical-list');
    const rows = list.querySelectorAll('.workflow-node-row');
    const workflow = findWorkflowById(workflowId);

    // Update UI highlights
    el.parentElement.querySelectorAll('.owner-filter-pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');

    rows.forEach(row => {
        if (ownerId === 'all') {
            row.style.display = 'flex';
            return;
        }

        const node = workflow.nodes.find(n => n.id === row.dataset.nodeId);
        const currentOwners = node.ownerIds || (node.ownerId ? [node.ownerId] : []);
        
        row.style.display = currentOwners.includes(ownerId) ? 'flex' : 'none';
    });
};

    function renderStagesAndNodes(workflow) {
      const nodes = (workflow.nodes || []).sort((a, b) => a.sortIndex - b.sortIndex);
      
      if (nodes.length === 0) {
          return `<div class="empty-hint" style="padding: 20px; text-align: center;">No steps yet.</div>`;
      }

return nodes.map((node, idx) => {
    const ownerIds = node.ownerIds || (node.ownerId ? [node.ownerId] : []);
    
    // --- New: Logic Metadata Previews ---
    const dueLabel = renderDueConfigLabel(node.dueConfig);
    const hasDueLogic = node.dueConfig && node.dueConfig.type !== 'static';
    const outcomes = node.outcomes || [];
    const outcomeCount = outcomes.length;

    let avatarStackHTML = ownerIds.length > 0 
        ? ownerIds.map(id => {
            const owner = findTeamMemberById(id);
            if (!owner) return '';
            return `<div class="mini-avatar" title="${esc(owner.name)}">${esc(OL.utils.getInitials(owner.name))}</div>`;
          }).join('')
        : `<div class="mini-avatar unassigned">?</div>`;

        return `
            <div class="workflow-node-row" data-node-id="${node.id}">
                <div class="node-handle-container">
                    <div class="node-drag-handle" draggable="true">⠿</div>
                </div>
                <div class="node-number">${idx + 1}</div>

                <div class="node-info-lane" onclick="OL.openNodeModal('${workflow.id}', '', '${node.id}', '${node.type}')">
                    <span class="node-type-icon">${node.type === 'resource' ? '🔗' : '✅'}</span>
                    <div class="node-text-group">
                        <span class="node-label">${esc(node.name)}</span>
                        
                        <div class="node-meta-preview">
                            ${node.type === 'step' ? `
                                <span class="meta-item ${hasDueLogic ? 'logic-active' : ''}" title="Due Date Logic">
                                    🕒 ${esc(dueLabel)}
                                </span>
                                ${outcomeCount > 0 ? `
                                    <span class="meta-item logic-active" title="Automated Outcomes">
                                        ⚡ ${outcomeCount} Path${outcomeCount > 1 ? 's' : ''}
                                    </span>
                                ` : ''}
                            ` : ''}
                        </div>
                    </div>

                    <div class="spacer"></div>
                    
                    <div class="avatar-trigger-zone" 
                        data-node-id="${node.id}" 
                        onclick="event.stopPropagation(); OL.openQuickAssign(event, '${workflow.id}', '${node.id}')">
                        ${avatarStackHTML}
                    </div>
                </div>
                
                <div class="node-actions-lane">
                    <button class="card-close" onclick="event.stopPropagation(); OL.deleteNodeFromWorkflow('${workflow.id}', '${node.id}')">×</button>
                </div>
            </div>
        `;
    }).join('');
  }

  OL.openQuickAssign = function(e, workflowId, nodeId) {
      const workflow = findWorkflowById(workflowId);
      const node = (workflow.nodes || []).find(n => n.id === nodeId);
      if (!node) return;

      const currentIds = node.ownerIds || (node.ownerId ? [node.ownerId] : []);

      openMappingDropdown({
          anchorEl: e.currentTarget,
          options: state.teamMembers.map(m => ({
              id: m.id,
              label: m.name,
              checked: currentIds.includes(m.id)
          })),
          allowMultiple: true,
          onSelect: (memberId, isChecked) => {
              if (!node.ownerIds) node.ownerIds = currentIds;

              if (isChecked) {
                  if (!node.ownerIds.includes(memberId)) node.ownerIds.push(memberId);
              } else {
                  node.ownerIds = node.ownerIds.filter(id => id !== memberId);
              }

              // Cleanup old single-owner reference
              delete node.ownerId;

              OL.persist();
              OL.openWorkflowVisualizer(workflow.id); // Refresh visuals

              // Keep dropdown open for further toggling
              const dd = document.querySelector(".mapping-dropdown");
              if (dd && dd.refresh) dd.refresh();
          }
      });
  };  

  function wireInternalVisualizerDnD(workflow, modalLayer) {

      function getDragAfterElement(container, y) {
          const draggableElements = [...container.querySelectorAll('.workflow-node-row:not(.dragging-node)')];

          return draggableElements.reduce((closest, child) => {
              const box = child.getBoundingClientRect();
              const offset = y - box.top - box.height / 2;
              if (offset < 0 && offset > closest.offset) {
                  return { offset: offset, element: child };
              } else {
                  return closest;
              }
          }, { offset: Number.NEGATIVE_INFINITY }).element;
      }

      const list = modalLayer.querySelector('.visualizer-vertical-list');
      const handles = modalLayer.querySelectorAll('.node-drag-handle');

      handles.forEach(handle => {
          const row = handle.closest('.workflow-node-row');
          
          // 1. Setup the Handle drag trigger
          handle.onmousedown = () => row.setAttribute('draggable', 'true');
          handle.onmouseup = () => row.setAttribute('draggable', 'false');

          row.ondragstart = (e) => {
              e.stopPropagation();
              e.dataTransfer.setData("application/json", JSON.stringify({
                  type: "workflow-node",
                  id: row.dataset.nodeId
              }));
              row.classList.add('dragging-node');
              
              // Standard ghost image
              if (e.dataTransfer.setDragImage) {
                  e.dataTransfer.setDragImage(row, 20, 20);
              }
          };

          row.ondragend = () => {
              row.classList.remove('dragging-node');
              row.setAttribute('draggable', 'false');
              list.querySelectorAll(".drag-over-node").forEach(el => el.classList.remove("drag-over-node"));
          };
      });

      // 2. Setup the List Container as the Drop Zone
      list.ondragover = (e) => {
          // 1. Tell the browser we are handling this event
          e.preventDefault(); 
          e.stopPropagation();

          // 2. Identify what is being dragged
          const draggingRow = modalLayer.querySelector('.dragging-node');
          if (!draggingRow) return;

          // 3. FORCE the cursor to 'move' (removes the forbidden symbol)
          e.dataTransfer.dropEffect = "move"; 

          // 4. Visual reordering logic
          const afterElement = getDragAfterElement(list, e.clientY);
          
          // Smooth DOM insertion
          if (afterElement == null) {
              list.appendChild(draggingRow);
          } else {
              list.insertBefore(draggingRow, afterElement);
          }
      };

      list.ondrop = (e) => {
          e.preventDefault();
          e.stopPropagation();

          // 3. RE-SYNC STATE: Rebuild the nodes array based on visual order
          const newNodes = [];
          modalLayer.querySelectorAll('.workflow-node-row').forEach((rowEl, index) => {
              const node = workflow.nodes.find(n => n.id === rowEl.dataset.nodeId);
              if (node) {
                  node.sortIndex = index; // Update the order index
                  newNodes.push(node);
              }
          });

          workflow.nodes = newNodes;
          OL.persist();
          
          // RE-RENDER: Refresh the visualizer to update the step numbers (1, 2, 3...)
          OL.openWorkflowVisualizer(workflow.id);
      };
  }

  window.handleOutcomeJump = function(type, workflowId, nodeId) {
    if (!nodeId && !workflowId) return;

    if (type === 'jump_step' && nodeId) {
        OL.closeModal();
        setTimeout(() => {
            // Re-open modal with the new step ID
            OL.openNodeModal(OL.activeWorkflowId, '', nodeId, 'step');
        }, 100);
    } else if (workflowId) {
        if (confirm("Navigate to the linked workflow?")) {
            OL.closeModal();
            OL.openWorkflowVisualizer(workflowId);
            if (nodeId) {
                setTimeout(() => OL.openNodeModal(workflowId, '', nodeId, 'step'), 300);
            }
        }
    }
};

  function bindVisualizerUI(workflow) {
      const layer = getModalLayer();
      if (!layer) return;

      // 1. Settings & Exit
      const settingsBtn = layer.querySelector('#btnEditWorkflowDetails');
      if (settingsBtn) {
          settingsBtn.onclick = () => {
              OL.closeModal();
              OL.openWorkflowModal(workflow.id, false);
          };
      }

      // 2. Wire the Add Button (Single button at the bottom of the list)
      const addBtn = layer.querySelector('.btn-add-node');
      if (addBtn) {
          addBtn.onclick = (e) => {
              e.stopPropagation();
              
              openMappingDropdown({
                  anchorEl: addBtn,
                  options: [
                      { id: 'step', label: '✅ Single Manual Step' },
                      { id: 'resource', label: '🔗 Link Existing Resource' },
                      { id: 'group_meeting', label: '📅 Meeting Group (Prep/Occurs/Follow-up)' },
                      { id: 'group_client', label: '📩 Client Task Group (Request/Follow-up/Done)' }
                  ],
                  allowMultiple: false,
                  onSelect: (choiceId) => {
                      if (choiceId.startsWith('group_')) {
                          // Handle Group Creation
                          const groupType = choiceId.replace('group_', '');
                          OL.createNodeGroup(workflow.id, groupType);
                      } else {
                          // Handle Single Node
                          OL.openNodeModal(workflow.id, "", null, choiceId);
                      }
                  }
              });
          };
      }

      // 3. Node Row Management (Click to Edit)
      layer.querySelectorAll('.node-info-lane').forEach(lane => {
          lane.onclick = (e) => {
              e.stopPropagation();
              const nodeRow = lane.closest('.workflow-node-row');
              const nodeId = nodeRow.dataset.nodeId;
              const node = (workflow.nodes || []).find(n => n.id === nodeId);
              
              if (node) {
                  // Open the editor for this specific step
                  OL.openNodeModal(workflow.id, node.stageId || "", node.id, node.type);
              }
          };
      });

      // 4. Drag and Drop Initialization
      if (typeof wireInternalVisualizerDnD === 'function') {
          wireInternalVisualizerDnD(workflow, layer);
      }
  }

  OL.createNodeGroup = function(workflowId, groupType) {
      const workflow = findWorkflowById(workflowId);
      if (!workflow) return;

      // 1. Prompt for the Variable Name
      const promptMsg = (groupType === 'meeting') 
          ? "Enter Meeting Type (e.g. Discovery, Annual Review):" 
          : "Enter Action Name (e.g. Signed Contract, Account Opening):";
      
      const varName = prompt(promptMsg);
      if (!varName) return; // Cancelled

      // 2. Define the Bundles
      let bundle = [];
      if (groupType === 'meeting') {
          bundle = [
              `Pre-Meeting Prep: ${varName}`,
              `Meeting Occurs: ${varName}`,
              `Post-Meeting Follow-Up: ${varName}`
          ];
      } else {
          bundle = [
              `Request Client Action: ${varName}`,
              `Client Action Follow Up: ${varName}`,
              `Client Action Completed: ${varName}`
          ];
      }

      // 3. Create and Push Nodes
      const startIdx = (workflow.nodes || []).length;
      
      bundle.forEach((name, i) => {
          const newNode = {
              id: uid(),
              type: 'step',
              name: name,
              sortIndex: startIdx + i,
              description: "",
              ownerIds: [],
              outcomes: [],
              // Defaulting dueConfig so relative logic can be added later
              dueConfig: { type: 'static', offsetDays: 0, offsetDirection: 'after' }
          };
          
          workflow.nodes = workflow.nodes || [];
          workflow.nodes.push(newNode);
      });

      // 4. Save and Refresh UI
      OL.persist();
      OL.openWorkflowVisualizer(workflow.id); 
  };
  // -------------------------------------------------------------
  // WORKFLOW LOGIC
  // -------------------------------------------------------------

  OL.addStageToWorkflow = function(workflowId) {
      const workflow = findWorkflowById(workflowId);
      if (!workflow) return;

      workflow.stages = workflow.stages || [];
      const maxSort = workflow.stages.reduce((max, s) => Math.max(max, s.sortIndex || 0), -1);

      const newStage = {
          id: uid(),
          name: prompt("Enter new stage name:", `New Stage ${workflow.stages.length + 1}`) || `New Stage`,
          sortIndex: maxSort + 1,
      };

      if (newStage.name === 'New Stage' && workflow.stages.length > 0) return; // User cancelled prompt

      workflow.stages.push(newStage);
      OL.persist();
      OL.openVisualizerScreen(workflowId); // Re-render the visualizer
  };

  OL.deleteStage = function(stageId) {
    const stage = state.workflowStages.find(s => s.id === stageId);
    const hasWorkflows = state.workflows.some(w => w.stageId === stageId);
    
    const msg = hasWorkflows 
        ? `Warning: This stage contains workflows. Deleting it will leave those workflows unassigned. Proceed?` 
        : `Delete stage "${stage.name}"?`;
        
    if (!confirm(msg)) return;
    
    state.workflowStages = state.workflowStages.filter(s => s.id !== stageId);
    OL.persist();
    renderWorkflowsGrid();
};

OL.deleteWorkflow = function(workflowId) {
    if (!confirm("Delete this workflow and all its steps?")) return;
    state.workflows = state.workflows.filter(w => w.id !== workflowId);
    OL.persist();
    renderWorkflowsGrid();
};

  // Add these functions after your existing workflow logic (OL.deleteStageFromWorkflow, etc.)

  // Helper function to find a Team Member (assuming you have a state.team array)
  function findTeamMemberById(id) {
      // Assuming state.team is an array of { id, name } objects
      return (state.teamMembers || []).find(m => m.id === id) || null; 
  }

  // Helper function to find a Resource (assuming you have a global getResourceById)
  function getResourceById(id) {
      // Assuming this function exists and iterates over all resource types in state.resources
      return OL.getResourceById(id); 
  }

  function bindNodeModal(workflow, node, isNew) {
    const layer = getModalLayer();
    if (!layer) return;

    let created = !node._draft;
    const isStep = node.type === 'step';
    const isResource = node.type === 'resource';

    // --- Commit Logic (Move from draft to saved) ---
    function commitNode() {
        if (created) return;
        const name = layer.querySelector("#nodeName").textContent.trim();
        if (!name) return; // Don't commit unnamed nodes

        created = true;
        delete node._draft;
        workflow.nodes = workflow.nodes || [];
        workflow.nodes.push(node); 
        OL.persist();
        
        // Refresh the visualizer behind the modal
        OL.renderWorkflowsGrid(); 
    }

    // --- 1. Shared Title/Notes Binding ---
    const nameEl = layer.querySelector("#nodeName");
    if (nameEl) {
        if (isNew) nameEl.textContent = "";
        nameEl.addEventListener("blur", () => {
            const v = nameEl.textContent.trim();
            if (!v) {
                if (isStep) node.name = "";
                return;
            }
            node.name = v;
            if (isNew) commitNode();
            OL.persist();
        });
    }

    // --- 2. STEP SPECIFIC: Multi-Assignee & Fields ---
    if (isStep) {
        // Multi-Assignee Trigger
        const assignBtn = layer.querySelector("#btnModalAssign");
        if (assignBtn) {
            assignBtn.onclick = (e) => {
                e.stopPropagation();
                // Support legacy data by converting ownerId to ownerIds on the fly
                const currentIds = node.ownerIds || (node.ownerId ? [node.ownerId] : []);
                
                openMappingDropdown({
                    anchorEl: assignBtn,
                    options: state.teamMembers.map(m => ({
                        id: m.id,
                        label: m.name,
                        checked: currentIds.includes(m.id)
                    })),
                    allowMultiple: true,
                    onSelect: (memberId, isChecked) => {
                        if (!node.ownerIds) node.ownerIds = currentIds;

                        if (isChecked) {
                            if (!node.ownerIds.includes(memberId)) node.ownerIds.push(memberId);
                        } else {
                            node.ownerIds = node.ownerIds.filter(id => id !== memberId);
                        }
                        
                        // Clean up legacy single property
                        delete node.ownerId; 
                        
                        if (isNew) commitNode();
                        OL.persist();
                        
                        // Update the pill display inside the modal
                        const pillBox = layer.querySelector("#modalOwnerPills");
                        if (pillBox) {
                            const newPills = node.ownerIds.map(id => {
                                const m = findTeamMemberById(id);
                                return m ? `<span class="pill fn">${esc(m.name)}</span>` : '';
                            }).join('');
                            pillBox.innerHTML = newPills || '<span class="pill muted">Unassigned</span>';
                        }

                        // Refresh dropdown state
                        const dd = document.querySelector(".mapping-dropdown");
                        if (dd && dd.refresh) dd.refresh();
                    }
                });
            };
        }

        const dueTrigger = layer.querySelector("#btnEditDueConfig");
        if (dueTrigger) {
            dueTrigger.onclick = (e) => {
                e.stopPropagation();
                // Call the mapper logic we defined
                OL.openDueConfigMapper(dueTrigger, workflow.id, node.id);
            };
        }
        const outcomeEl = layer.querySelector("#nodeOutcome");
        if (outcomeEl) outcomeEl.oninput = debounce((e) => { node.outcomes = [
            {
                type: 'jump_step', // jump_step | jump_external | start_workflow | close_workflow | restart_step | restart_workflow
                targetWorkflowId: null,
                targetNodeId: null,
                label: 'If Client Accepts...' // Optional label for the button
            }
        ];
        if (isNew) commitNode(); OL.persist(); }, 200);

        const descEl = layer.querySelector("#nodeDesc");
        if (descEl) descEl.oninput = debounce((e) => { node.description = e.target.value; if (isNew) commitNode(); OL.persist(); }, 200);

        const addOutcomeBtn = layer.querySelector("#btnAddOutcome");
        if (addOutcomeBtn) {
            addOutcomeBtn.onclick = (e) => {
                e.stopPropagation();
                // Call the cascading dropdown logic
                OL.openOutcomeMapper(addOutcomeBtn, workflow.id, node.id);
            };
        }

        // 1. Locate the container
        const outcomeList = layer.querySelector("#modalOutcomeList");
        if (outcomeList) {
            // 2. Bind the Jump logic
            outcomeList.querySelectorAll(".outcome-jump-trigger").forEach(btn => {
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const idx = btn.dataset.idx;
                    const oc = node.outcomes[idx];
                    if (oc) {
                        console.log("Jumping to:", oc);
                        window.handleOutcomeJump(oc.type, oc.targetWorkflowId, oc.targetNodeId);
                    }
                };
            });

            // 3. Bind the Delete logic
            outcomeList.querySelectorAll(".outcome-delete-trigger").forEach(btn => {
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.idx);
                    OL.removeOutcome(workflow.id, node.id, idx);
                };
            });
        }
    }

    // --- 3. RESOURCE SPECIFIC Binding ---
    if (isResource) {
        const resSelect = layer.querySelector("#nodeResource");
        if (resSelect) {
            resSelect.onchange = (e) => {
                node.resourceId = e.target.value;
                if (e.target.value) {
                    const resource = getResourceById(e.target.value);
                    if (resource && (node.name === 'Linked Resource' || !node.name)) {
                        node.name = resource.name;
                        if (nameEl) nameEl.textContent = resource.name;
                    }
                }
                if (isNew) commitNode();
                OL.persist();
            };
        }

        const notesEl = layer.querySelector("#nodeNotes");
        if (notesEl) notesEl.oninput = debounce((e) => { node.notes = e.target.value; if (isNew) commitNode(); OL.persist(); }, 200);
    }

    // --- 4. Global Action Buttons ---
    const saveBtn = layer.querySelector("#btnSaveNode");
    if (saveBtn) {
        saveBtn.onclick = () => {
            const name = nameEl ? nameEl.textContent.trim() : "";
            if (!name) { alert("Please enter a title."); return; }
            
            if (isNew) commitNode();
            OL.persist();
            OL.returnToVisualizer(workflow.id);
        };
    }

    const deleteBtn = layer.querySelector("#btnDeleteNode");
    if (deleteBtn) {
        deleteBtn.onclick = () => {
            if (confirm("Delete this step?")) {
                OL.deleteNodeFromWorkflow(workflow.id, node.id);
                OL.closeModal();
                OL.openWorkflowVisualizer(workflow.id);
            }
        };
    }

    // Inside bindNodeModal(workflow, node, isNew)

    // 1. App Mapping
    const btnAddApp = layer.querySelector("#btnStepAddApp");
    if (btnAddApp) {
        btnAddApp.onclick = (e) => {
            e.stopPropagation();
            const currentIds = node.appIds || [];
            openMappingDropdown({
                anchorEl: btnAddApp,
                options: state.apps.map(a => ({ id: a.id, label: a.name, checked: currentIds.includes(a.id) })),
                allowMultiple: true,
                onSelect: (appId, isChecked) => {
                    node.appIds = node.appIds || [];
                    if (isChecked) { if (!node.appIds.includes(appId)) node.appIds.push(appId); }
                    else { node.appIds = node.appIds.filter(id => id !== appId); }
                    OL.persist();
                    layer.querySelector("#modalAppList").innerHTML = renderNodeAppPills(node);
                }
            });
        };
    }

    // 2. Resource Mapping
    const btnAddRes = layer.querySelector("#btnStepAddResource");
    if (btnAddRes) {
        btnAddRes.onclick = (e) => {
            e.stopPropagation();
            const currentIds = node.resourceIds || [];
            openMappingDropdown({
                anchorEl: btnAddRes,
                options: state.resources.map(r => ({ id: r.id, label: r.name, checked: currentIds.includes(r.id) })),
                allowMultiple: true,
                onSelect: (resId, isChecked) => {
                    node.resourceIds = node.resourceIds || [];
                    if (isChecked) { if (!node.resourceIds.includes(resId)) node.resourceIds.push(resId); }
                    else { node.resourceIds = node.resourceIds.filter(id => id !== resId); }
                    OL.persist();
                    layer.querySelector("#modalResourceList").innerHTML = renderNodeResourcePills(node);
                }
            });
        };
    }
}

OL.removeAppFromNode = function(nodeId, appId) {
    const workflow = findWorkflowById(OL.activeWorkflowId);
    const node = workflow.nodes.find(n => n.id === nodeId);
    node.appIds = (node.appIds || []).filter(id => id !== appId);
    OL.persist();
    OL.openNodeModal(workflow.id, '', nodeId, 'step');
};

OL.removeResourceFromNode = function(nodeId, resId) {
    const workflow = findWorkflowById(OL.activeWorkflowId);
    const node = workflow.nodes.find(n => n.id === nodeId);
    node.resourceIds = (node.resourceIds || []).filter(id => id !== resId);
    OL.persist();
    OL.openNodeModal(workflow.id, '', nodeId, 'step');
};
  // -------------------------------------------------------------
  // WORKFLOW NODE ACTIONS
  // -------------------------------------------------------------

  OL.deleteNodeFromWorkflow = function(workflowId, nodeId) {
      const workflow = findWorkflowById(workflowId);
      if (!workflow) return;

      const node = (workflow.nodes || []).find(n => n.id === nodeId);
      if (!node) return;
      
      if (!confirm(`Delete ${node.type === 'step' ? 'step' : 'resource link'} "${node.name}"?`)) return;

      workflow.nodes = workflow.nodes.filter(n => n.id !== nodeId);
      
      // Re-index nodes in that stage (important for drag/drop later)
      (workflow.nodes || [])
          .filter(n => n.stageId === node.stageId)
          .sort((a, b) => a.sortIndex - b.sortIndex)
          .forEach((n, index) => n.sortIndex = index);

      OL.persist();
      OL.openVisualizerScreen(workflowId); // Re-render the visualizer
  };
/**
 * Attaches drag-and-drop event handlers for workflow nodes and stage bodies.
 */
function wireWorkflowDragAndDrop() {
    const grid = document.getElementById("workflowsGrid");
    const handles = grid.querySelectorAll(".workflow-drag-handle");
    const lists = grid.querySelectorAll(".process-list");

    handles.forEach(handle => {
        const row = handle.closest(".process-street-row");
        
        // Ensure only the handle triggers the drag
        handle.setAttribute("draggable", "true");
        row.setAttribute("draggable", "false");

        handle.ondragstart = (e) => {
            e.stopPropagation(); // Stops the Stage from reacting
            e.dataTransfer.setData("application/json", JSON.stringify({
                type: "workflow",
                id: row.dataset.workflowId
            }));
            row.classList.add("dragging-workflow");
            // This ensures the user sees the whole row moving
            if (e.dataTransfer.setDragImage) {
                e.dataTransfer.setDragImage(row, 20, 20);
            }
            e.dataTransfer.effectAllowed = "move";
        };

        handle.ondragend = () => {
            row.classList.remove("dragging-workflow");
            grid.querySelectorAll(".drag-over-list").forEach(el => el.classList.remove("drag-over-list"));
        };
    });

    lists.forEach(list => {
        list.ondragover = (e) => {
            // Check if what we are dragging is actually a workflow
            const isWorkflow = grid.querySelector(".dragging-workflow");
            if (!isWorkflow) return;

            e.preventDefault(); // REQUIRED to allow the drop to happen
            e.stopPropagation();
            list.classList.add("drag-over-list");
        };

        list.ondragleave = (e) => {
            // Only remove highlight if actually leaving the container
            if (e.relatedTarget && !list.contains(e.relatedTarget)) {
                list.classList.remove("drag-over-list");
            }
        };

        list.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            list.classList.remove("drag-over-list");

            let data;
            try {
                data = JSON.parse(e.dataTransfer.getData("application/json"));
            } catch (err) { return; }

            if (data.type !== "workflow") return;

            const workflowId = data.id;
            const targetStageId = list.closest(".workflow-stage-block").dataset.stageId;
            const workflow = OL.state.workflows.find(w => w.id === workflowId);
            
            if (workflow) {
                // 1. Find where to insert based on mouse position
                const draggingRow = grid.querySelector(".dragging-workflow");
                const afterElement = getDragAfterElement(list, e.clientY);

                // 2. Update the Stage ID
                workflow.stageId = targetStageId;

                // 3. Update DOM order so we can read it
                if (afterElement == null) {
                    list.appendChild(draggingRow);
                } else {
                    list.insertBefore(draggingRow, afterElement);
                }

                // 4. SYNC STATE: Rebuild array based on final visual order
                const newOrder = [];
                document.querySelectorAll(".process-street-row").forEach(r => {
                    const found = OL.state.workflows.find(w => w.id === r.dataset.workflowId);
                    if (found) newOrder.push(found);
                });
                
                OL.state.workflows = newOrder;
                OL.persist();
                renderWorkflowsGrid(); // Refresh to confirm order
            }
        };
    });
}

/**
 * Opens the modal to edit a specific Step or Resource Link within a vertical workflow.
 */
OL.openNodeModal = function(workflowId, stageId, nodeId = null, type = 'step') {
    const workflow = findWorkflowById(workflowId);
    if (!workflow) return;

    let node = (workflow.nodes || []).find(n => n.id === nodeId);
    const isNew = !node;

    if (isNew) {
        node = {
            id: uid(),
            _draft: true,
            type: type, // 'step' or 'resource'
            stageId: stageId,
            sortIndex: (workflow.nodes || []).length,
            name: type === 'resource' ? 'Linked Resource' : 'New Task',
            description: "",
            ownerId: null,
            dueDate: "",
            outcome: "",
            resourceId: null,
            notes: ""
        };
    }

    openModal(renderNodeModalHTML(workflow, node, isNew));
    setTimeout(() => bindNodeModal(workflow, node, isNew), 0);
};

function renderNodeModalHTML(workflow, node, isNew) {
    const isStep = node.type === 'step';
    const ownerIds = node.ownerIds || (node.ownerId ? [node.ownerId] : []);
    
    // Generate the list of initials/names for the modal preview
    const assignedNames = ownerIds.map(id => {
        const m = findTeamMemberById(id);
        return m ? `<span class="pill fn">${esc(m.name)}</span>` : '';
    }).join('');

    const dueDisplay = renderDueConfigLabel(node.dueConfig);
    const outcomesCount = (node.outcomes || []).length;

    return `
        <div class="modal-head">
            <div id="nodeName" class="modal-title-text" contenteditable="true" data-placeholder="Step Title">
                ${esc(node.name || "")}
            </div>
            <div class="spacer"></div>
            <button class="btn small soft" onclick="OL.returnToVisualizer('${workflow.id}')">Close</button>
        </div>
        <div class="modal-body">
            <label class="modal-section-label">Instructions / Description</label>
            <textarea id="nodeDesc" class="modal-textarea" placeholder="What needs to be done?">${esc(node.description || "")}</textarea>

            ${isStep ? `
                <div class="modal-row">
                    <div class="modal-column">
                        <label class="modal-section-label">Assigned To</label>
                        <div class="modal-assignee-box">
                            <div id="modalOwnerPills" class="pills-row">
                                ${assignedNames || '<span class="pill muted">Unassigned</span>'}
                            </div>
                            <button class="btn xsmall soft" id="btnModalAssign">Edit Assignees</button>
                        </div>
                    </div>
                    <div class="modal-column">
                      <label class="modal-section-label">Due Date Logic</label>
                      <div class="due-config-trigger" id="btnEditDueConfig">
                          <span class="due-icon">🕒</span>
                          <span id="dueConfigSummary">${dueDisplay}</span>
                      </div>
                  </div>
                </div>
                <div class="modal-section" style="margin-top:15px;">
                    <label class="modal-section-label">Apps Used</label>
                    <div id="modalAppList" class="pills-row" style="margin: 8px 0;">
                        ${renderNodeAppPills(node)}
                    </div>
                    <button class="btn xsmall soft" id="btnStepAddApp">+ Map App</button>
                </div>

                <div class="modal-section" style="margin-top:15px;">
                    <label class="modal-section-label">Resources Used</label>
                    <div id="modalResourceList" class="pills-row" style="margin: 8px 0;">
                        ${renderNodeResourcePills(node)}
                    </div>
                    <button class="btn xsmall soft" id="btnStepAddResource">+ Map Resource</button>
                </div>
                <div class="modal-section" style="margin-top:15px;">
                  <label class="modal-section-label">Automated Outcomes</label>
                 <div id="modalOutcomeList" class="pills-row" style="margin: 8px 0;">
                      ${(node.outcomes || []).map((oc, i) => {
                          const hasTarget = oc.targetNodeId || oc.targetWorkflowId;
                          return `
                              <div class="pill outcome-pill" 
                                  style="display: inline-flex; align-items: stretch; border: 1px solid var(--line); background: var(--panel-soft); border-radius: 4px; overflow: hidden; margin: 2px;">
                                  
                                  <button class="outcome-jump-trigger" 
                                      data-idx="${i}"
                                      style="background: none; border: none; padding: 4px 10px; font-size: 11px; font-family: inherit; cursor: pointer; color: var(--accent); display: flex; align-items: center; text-align: left;">
                                      ${getOutcomeLabel(oc)} ${hasTarget ? ' ↗' : ''}
                                  </button>
                                  
                                  <button class="outcome-delete-trigger" 
                                      data-idx="${i}"
                                      style="background: none; border: none; padding: 4px 8px; border-left: 1px solid var(--line); cursor: pointer; color: var(--muted); font-family: inherit;">
                                      ×
                                  </button>
                              </div>`;
                      }).join('')}
                  </div>
                  </div>
                  <button class="btn xsmall soft" id="btnAddOutcome">+ Add Outcome</button>
              </div>
            ` : `
                <label class="modal-section-label">Link to Existing Resource</label>
                <select id="nodeResource" class="modal-select">
                    <option value="">Select a Resource...</option>
                    ${(state.resources || []).map(r => `<option value="${r.id}" ${node.resourceId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
                </select>
                <label class="modal-section-label">Context Notes</label>
                <textarea id="nodeNotes" class="modal-textarea">${esc(node.notes || "")}</textarea>
            `}

            <div style="margin-top: 20px; display: flex; gap: 10px;">
                <button class="btn small primary" id="btnSaveNode">Save Step</button>
                ${!isNew ? `<button class="btn small warn" onclick="OL.deleteNodeFromWorkflow('${workflow.id}', '${node.id}')">Delete Step</button>` : ''}
            </div>
        </div>
    `;
}

function renderNodeAppPills(node) {
    const directAppIds = node.appIds || [];
    const implicitAppIds = [];

    // 1. Gather apps from linked resources
    (node.resourceIds || []).forEach(resId => {
        const res = getResourceById(resId);
        if (res && res.appIds) {
            res.appIds.forEach(id => {
                if (!directAppIds.includes(id) && !implicitAppIds.includes(id)) {
                    implicitAppIds.push(id);
                }
            });
        }
    });

    if (!directAppIds.length && !implicitAppIds.length) return `<div class="empty-hint">No apps mapped.</div>`;

    const directHTML = directAppIds.map(id => renderSingleAppPill(id, node.id, false)).join('');
    const implicitHTML = implicitAppIds.map(id => renderSingleAppPill(id, node.id, true)).join('');

    return directHTML + implicitHTML;
}

// Helper to handle the shared styling and "Remove" restriction for implicit apps
function renderSingleAppPill(appId, nodeId, isImplicit) {
    const app = findAppById(appId);
    if (!app) return '';
    
    return `
        <div class="pill outcome-pill ${isImplicit ? 'pill-implicit' : ''}" 
             title="${isImplicit ? 'Inherited from linked resource' : ''}">
            <button class="nav-zone-btn" 
                 onclick="event.stopPropagation(); OL.closeModal(); setTimeout(() => OL.openAppModal('${appId}'), 50)">
                ${OL.iconHTML(app)} <span style="margin-left:6px;">${esc(app.name)}</span>
                ${isImplicit ? '<span class="implicit-tag">🔗</span>' : ''}
            </button>
            ${!isImplicit ? `
                <button class="remove-zone-btn" onclick="event.stopPropagation(); OL.removeAppFromNode('${nodeId}', '${appId}')">×</button>
            ` : ''}
        </div>`;
}

function getResourcesAndWorkflowsForApp(appId) {
    const linkedResources = (state.resources || []).filter(r => r.appIds?.includes(appId));
    
    const linkedWorkflows = [];
    state.workflows.forEach(wf => {
        const hasStepUsingApp = wf.nodes?.some(node => 
            node.appIds?.includes(appId) || 
            node.resourceIds?.some(rId => getResourceById(rId)?.appIds?.includes(appId))
        );
        if (hasStepUsingApp) linkedWorkflows.push(wf);
    });

    return { resources: linkedResources, workflows: linkedWorkflows };
}

function renderNodeResourcePills(node) {
    const resIds = node.resourceIds || [];
    if (!resIds.length) return `<div class="empty-hint">No resources mapped.</div>`;
    return resIds.map(id => {
        const res = getResourceById(id);
        if (!res) return '';
        return `
            <div class="pill outcome-pill" style="display: inline-flex; align-items: stretch; border: 1px solid var(--line); background: var(--panel-soft); border-radius: 4px; overflow: hidden; margin: 2px;">
                <button class="nav-zone-btn" 
                     style="background: none; border: none; padding: 4px 10px; font-size: 11px; font-family: inherit; cursor: pointer; color: var(--accent); display: flex; align-items: center;"
                     onclick="event.stopPropagation(); OL.closeModal(); setTimeout(() => OL.openResourceModal('${id}'), 50)">
                    <span>📄 ${esc(res.name)}</span>
                </button>
                <button class="remove-zone-btn" 
                     style="background: none; border: none; padding: 4px 8px; border-left: 1px solid var(--line); cursor: pointer; color: var(--muted); font-family: inherit;"
                     onclick="event.stopPropagation(); OL.removeResourceFromNode('${node.id}', '${id}')">
                    ×
                </button>
            </div>`;
    }).join('');
}
OL.handleOutcomeJump = function(type, targetWorkflowId, targetNodeId) {
    console.log("Jumping:", { type, targetWorkflowId, targetNodeId });

    // 1. Jump to a step in the SAME workflow
    if (type === 'jump_step' && targetNodeId) {
        // Find the workflow ID from the open visualizer context
        const currentWorkflowId = OL.activeWorkflowId; // We will set this in Step 2
        if (currentWorkflowId) {
            OL.closeModal(); // Close current step modal
            setTimeout(() => {
                OL.openNodeModal(currentWorkflowId, '', targetNodeId, 'step');
            }, 50);
        }
    } 
    // 2. Jump to or Start an EXTERNAL workflow
    else if ((type === 'jump_external' || type === 'start_workflow') && targetWorkflowId) {
        const targetWf = findWorkflowById(targetWorkflowId);
        if (confirm(`Maps to workflow: ${targetWf?.name || 'Target'}?`)) {
            OL.closeModal(); 
            OL.openWorkflowVisualizer(targetWorkflowId);
            
            if (targetNodeId) {
                setTimeout(() => {
                    OL.openNodeModal(targetWorkflowId, '', targetNodeId, 'step');
                }, 100);
            }
        }
    }
};

OL.openOutcomeMapper = function(anchorEl, workflowId, nodeId) {
    const workflow = findWorkflowById(workflowId);
    const node = workflow.nodes.find(n => n.id === nodeId);

    const options = [
        { id: 'jump_step', label: '↪️ Jump to Step (Same WF)' },
        { id: 'jump_external', label: '🌐 Jump to Step (Other WF)' },
        { id: 'start_workflow', label: '🚀 Start Next Workflow' },
        { id: 'restart_step', label: '🔄 Restart This Step' },
        { id: 'restart_workflow', label: '🔁 Restart Entire Workflow' },
        { id: 'close_workflow', label: '🏁 Close Current Workflow' }
    ];

    openMappingDropdown({
        anchorEl: anchorEl,
        options: options,
        allowMultiple: false,
        onSelect: (typeId) => {
            const newOutcome = { type: typeId };
            
            // Cascading Logic
            setTimeout(() => {
                if (typeId === 'jump_step') {
                    promptStepTarget(workflow, node, newOutcome);
                } else if (typeId === 'jump_external' || typeId === 'start_workflow') {
                    promptWorkflowTarget(workflow, node, newOutcome);
                } else {
                    saveOutcome(workflow, node, newOutcome);
                }
            }, 50);
        }
    });
};

OL.removeOutcome = function(workflowId, nodeId, outcomeIdx) {
    const workflow = findWorkflowById(workflowId);
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node || !node.outcomes) return;

    node.outcomes.splice(outcomeIdx, 1);
    OL.persist();
    
    // Refresh the modal to show updated list
    OL.openNodeModal(workflow.id, '', node.id, 'step');
};

// Helper to find a node regardless of which workflow it's in (for display)
function findNodeInWorkflow(nodeId) {
    for (const wf of state.workflows) {
        const found = wf.nodes.find(n => n.id === nodeId);
        if (found) return found;
    }
    return null;
}

function promptStepTarget(workflow, node, newOutcome) {
    const options = workflow.nodes
        .filter(n => n.id !== node.id)
        .map(n => ({ id: n.id, label: `Jump to: ${n.name}` }));

    openMappingDropdown({
        anchorEl: document.getElementById('btnAddOutcome'),
        options: options,
        allowMultiple: false,
        onSelect: (targetId) => {
            newOutcome.targetNodeId = targetId;
            saveOutcome(workflow, node, newOutcome);
        }
    });
}

function promptWorkflowTarget(workflow, node, newOutcome) {
    const options = state.workflows.map(w => ({ id: w.id, label: w.name }));
    openMappingDropdown({
        anchorEl: document.getElementById('btnAddOutcome'),
        options: options,
        allowMultiple: false,
        onSelect: (wfId) => {
            newOutcome.targetWorkflowId = wfId;
            if (newOutcome.type === 'jump_external') {
                // If jumping external, we need to pick the specific step in that WF too
                const targetWf = findWorkflowById(wfId);
                const stepOptions = targetWf.nodes.map(n => ({ id: n.id, label: n.name }));
                setTimeout(() => {
                    openMappingDropdown({
                        anchorEl: document.getElementById('btnAddOutcome'),
                        options: stepOptions,
                        allowMultiple: false,
                        onSelect: (stepId) => {
                            newOutcome.targetNodeId = stepId;
                            saveOutcome(workflow, node, newOutcome);
                        }
                    });
                }, 50);
            } else {
                saveOutcome(workflow, node, newOutcome);
            }
        }
    });
}

function saveOutcome(workflow, node, outcome) {
    // 1. Prompt for a label to identify this path
    const label = prompt("Enter a label for this path (e.g., 'If Client Accepts', 'If Info Missing'):");
    if (!label) return; // Cancel if no label provided

    outcome.label = label;
    node.outcomes = node.outcomes || [];
    node.outcomes.push(outcome);
    
    OL.persist();
    OL.openNodeModal(workflow.id, '', node.id, 'step'); 
}

function getOutcomeLabel(oc) {
    const prefix = oc.label ? `<strong>${esc(oc.label)}</strong>: ` : '';
    let action = "Action";

    if (oc.type === 'jump_step') {
        // Look in active workflow first
        const workflow = findWorkflowById(OL.activeWorkflowId);
        const node = workflow?.nodes.find(n => n.id === oc.targetNodeId);
        action = node ? `Jump to ${node.name}` : 'Jump to Step';
    } else if (oc.type === 'start_workflow' || oc.type === 'jump_external') {
        const wf = findWorkflowById(oc.targetWorkflowId);
        action = wf ? `Open ${wf.name}` : 'Open Workflow';
    } else if (oc.type === 'close_workflow') {
        action = "🏁 Finish";
    }

    return prefix + action;
}

function renderDueConfigLabel(config) {
    if (!config) return 'Set Date';
    if (config.type === 'static') return config.staticDate || 'Set Date';
    
    const symbol = config.offsetDirection === 'after' ? '▶' : '◀';
    const days = `${config.offsetDays}d`;
    
    const typeLabels = {
        workflow_start: 'Start',
        workflow_end: 'End',
        relative_step: 'Step',
        external_step: 'Cross-WF'
    };

    return `${days} ${symbol} ${typeLabels[config.type] || ''}`;
}

OL.openDueConfigMapper = function(anchorEl, workflowId, nodeId) {
    const workflow = findWorkflowById(workflowId);
    if (!workflow) return;
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const options = [
        { id: 'static', label: '📅 Specific Static Date' },
        { id: 'workflow_start', label: '🚀 Relative to Workflow Start' },
        { id: 'workflow_end', label: '🏁 Relative to Workflow End' },
        { id: 'relative_step', label: '🔗 Relative to another Step' },
        { id: 'external_step', label: '🌐 Relative to Step in different Workflow' }
    ];

    openMappingDropdown({
        anchorEl: anchorEl,
        options: options,
        allowMultiple: false,
        onSelect: (typeId) => {
            if (!node.dueConfig) {
                node.dueConfig = { offsetDays: 0, offsetDirection: 'after' };
            }
            node.dueConfig.type = typeId;

            // Use a tiny delay to ensure the previous dropdown DOM is cleared 
            // before the next one calculates its position
            setTimeout(() => {
                if (typeId === 'static') {
                    OL.openMiniCalendar(anchorEl, node.dueConfig.staticDate || new Date().toISOString().split('T')[0], (newDate) => {
                        node.dueConfig.staticDate = newDate;
                        finishDueMapping(workflow, node);
                    });
                } else if (typeId === 'relative_step') {
                    promptStepDependency(workflow, node);
                } else if (typeId === 'external_step') {
                    promptExternalDependency(workflow, node);
                } else {
                    // For start/end, go straight to picking days
                    promptOffsetDetails(workflow, node);
                }
            }, 50); 
        }
    });
};

OL.openMiniCalendar = function(anchorEl, initialDate, onSelect) {
    let [y, m, d] = initialDate.split('-').map(Number);
    let viewYear = y, viewMonth = m - 1;

    const dropdown = document.createElement("div");
    dropdown.className = "mapping-dropdown cal-dropdown";
    document.body.appendChild(dropdown);

    const rect = anchorEl.getBoundingClientRect();
    dropdown.style.left = rect.left + "px";
    dropdown.style.top = rect.bottom + "px";

    function refresh() {
        dropdown.innerHTML = renderCalendarHTML(viewYear, viewMonth, initialDate);
        
        // Navigation
        dropdown.querySelectorAll('.cal-nav').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                viewMonth += parseInt(btn.dataset.dir);
                if (viewMonth < 0) { viewMonth = 11; viewYear--; }
                if (viewMonth > 11) { viewMonth = 0; viewYear++; }
                refresh();
            };
        });

        // Date selection
        dropdown.querySelectorAll('.cal-date').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                onSelect(el.dataset.date);
                dropdown.remove();
            };
        });
    }

    refresh();
    
    // Close on outside click
    const outside = (e) => { if (!dropdown.contains(e.target)) { dropdown.remove(); document.removeEventListener('click', outside); }};
    setTimeout(() => document.addEventListener('click', outside), 10);
};

function promptOffsetDetails(workflow, node) {
    const anchorEl = document.getElementById('btnEditDueConfig');
    
    // Create a logical list of common offsets
    const options = [
        { id: '0_after',  label: 'Same Day' },
        { id: '1_after',  label: '1 Day After' },
        { id: '2_after',  label: '2 Days After' },
        { id: '3_after',  label: '3 Days After' },
        { id: '7_after',  label: '1 Week After' },
        { id: '14_after', label: '2 Weeks After' },
        { id: '30_after', label: '1 Month After' },
        { id: '1_before', label: '1 Day Before' },
        { id: '2_before', label: '2 Days Before' },
        { id: '7_before', label: '1 Week Before' }
    ];

    openMappingDropdown({
        anchorEl: anchorEl,
        options: options,
        allowMultiple: false,
        onSelect: (val) => {
            const [days, dir] = val.split('_');
            node.dueConfig.offsetDays = parseInt(days);
            node.dueConfig.offsetDirection = dir;
            finishDueMapping(workflow, node);
        }
    });
}

function promptStepDependency(workflow, node) {
    const anchorEl = document.getElementById('btnEditDueConfig');
    const options = workflow.nodes
        .filter(n => n.id !== node.id)
        .map(n => ({ id: n.id, label: `After: ${n.name || 'Unnamed Step'}` }));

    openMappingDropdown({
        anchorEl: anchorEl,
        options: options,
        allowMultiple: false,
        onSelect: (targetId) => {
            node.dueConfig.relativeNodeId = targetId;
            // Immediate cascade to the next choice
            setTimeout(() => promptOffsetDetails(workflow, node), 50);
        }
    });
}

function renderCalendarHTML(year, month, selectedDate) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const date = new Date(year, month, 1);
    const days = [];
    
    // Fill padding for start of month
    for (let i = 0; i < date.getDay(); i++) days.push('');
    
    // Fill actual days
    while (date.getMonth() === month) {
        days.push(new Date(date));
        date.setDate(date.getDate() + 1);
    }

    const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(year, month));

    return `
        <div class="mini-cal">
            <div class="mini-cal-header">
                <button class="cal-nav" data-dir="-1">◀</button>
                <span>${monthName} ${year}</span>
                <button class="cal-nav" data-dir="1">▶</button>
            </div>
            <div class="mini-cal-grid">
                ${names.map(n => `<div class="cal-day-name">${n[0]}</div>`).join('')}
                ${days.map(d => {
                    if (!d) return `<div class="cal-empty"></div>`;
                    const iso = d.toISOString().split('T')[0];
                    const isSelected = iso === selectedDate ? 'selected' : '';
                    return `<div class="cal-date ${isSelected}" data-date="${iso}">${d.getDate()}</div>`;
                }).join('')}
            </div>
        </div>
    `;
}

function finishDueMapping(workflow, node) {
    OL.persist();
    // Re-render the modal to show the new summary text
    OL.openNodeModal(workflow.id, '', node.id, 'step');
}

function promptExternalDependency(workflow, node) {
    const wfOptions = state.workflows.map(w => ({ id: w.id, label: w.name }));
    
    openMappingDropdown({
        anchorEl: document.getElementById('btnEditDueConfig'),
        options: wfOptions,
        allowMultiple: false,
        onSelect: (extWfId) => {
            node.dueConfig.externalWorkflowId = extWfId;
            const extWf = findWorkflowById(extWfId);
            const stepOptions = extWf.nodes.map(n => ({ id: n.id, label: n.name }));
            
            setTimeout(() => {
                openMappingDropdown({
                    anchorEl: document.getElementById('btnEditDueConfig'),
                    options: stepOptions,
                    allowMultiple: false,
                    onSelect: (extNodeId) => {
                        node.dueConfig.externalNodeId = extNodeId;
                        promptOffsetDetails(workflow, node);
                    }
                });
            }, 100);
        }
    });
}

function promptRelativeDueDetails(workflow, node) {
    const days = prompt("How many days offset?", "0");
    const dir = confirm("Click OK for 'After', Cancel for 'Before'") ? 'after' : 'before';
    
    node.dueConfig.offsetDays = parseInt(days) || 0;
    node.dueConfig.offsetDirection = dir;

    if (node.dueConfig.type === 'relative_step') {
        const otherSteps = workflow.nodes
            .filter(n => n.id !== node.id)
            .map(n => n.name || 'Unnamed Step')
            .join("\n");
        alert("Select the step this depends on:\n" + otherSteps);
        // In a full build, this would be another dropdown of step names.
    }

    OL.persist();
    // Re-open to refresh the summary label
    OL.openNodeModal(workflow.id, '', node.id, 'step');
}

/**
 * Closes the current edit modal and re-opens the Visualizer 
 * for the parent workflow.
 */
OL.returnToVisualizer = function(workflowId) {
    // 1. Standard close to clear the 'edit' content
    OL.closeModal(); 
    
    // 2. Immediately re-open the visualizer for that workflow
    // This restores the single-column list view.
    OL.openWorkflowVisualizer(workflowId); 
};
/**
 * Scans the workflowStages array and updates names to match their sort order.
 * e.g., "05 - Discovery" becomes "01 - Discovery" if moved to the first slot.
 */
function autoRenumberStages() {
    const stages = OL.state.workflowStages;
    
    // Sort by current sortIndex to ensure we label 1 through X correctly
    stages.sort((a, b) => a.sortIndex - b.sortIndex);

    stages.forEach((stage, idx) => {
        const displayNum = (idx + 1).toString().padStart(2, '0');
        
        // Matches digits at the start, followed by optional spaces/dashes/colons
        const namePattern = /^\d+\s*[-:]?\s*/;
        
        if (namePattern.test(stage.name)) {
            stage.name = stage.name.replace(namePattern, `${displayNum} - `);
        } else {
            // Prepend if no number exists
            stage.name = `${displayNum} - ${stage.name}`;
        }
    });
}

  //--------------------------------------------------------
  // FEATURES GRID
  //--------------------------------------------------------
  // Helper function to find a feature (already needed from the analysis implementation)
  function findFeatureById(id) {
      return (state.features || []).find(f => f.id === id) || null;
  }

  function renderFeaturesGrid() {
      const grid = document.getElementById("featuresGrid");
      if (!grid) return;
      grid.innerHTML = "";

      const features = [...state.features].sort((a, b) =>
          (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase())
      );

      if (!features.length) {
          grid.innerHTML = `<div class="empty-hint">No evaluation features defined yet.</div>`;
          return;
      }

      features.forEach(feature => {
          const group = feature.category || (findFunctionById(feature.functionId)?.name) || "Unassigned";
          
          grid.insertAdjacentHTML("beforeend", `
              <div class="card" data-feature-id="${feature.id}" onclick="OL.openFeatureModal('${feature.id}')">
                  <div class="card-header">
                      <div class="card-header-left">
                          <div class="card-title">${esc(feature.name)}</div>
                      </div>
                      <div class="card-close"
                          onclick="event.stopPropagation(); OL.deleteFeature('${feature.id}')">×</div>
                  </div>
                  <div class="card-body">
                      <div class="card-section">
                          <div class="card-section-title">Group</div>
                          <div class="card-section-content single-line-text">${esc(group)}</div>
                      </div>
                  </div>
              </div>
          `);
      });
  }
  // ------------------------------------------------------------------------------------

  function renderFeatureModalHTML(feature) {
      const groupOptions = ["General", "Security", "Integration"].map(cat => 
          `<option value="${cat}" ${feature.category === cat ? "selected" : ""}>${cat} (Fixed Category)</option>`
      ).join("");
      
      // Include all Functions as grouping options
      const functionOptions = state.functions.map(fn => 
          `<option value="${fn.id}" ${feature.functionId === fn.id ? "selected" : ""}>${esc(fn.name)} (Function)</option>`
      ).join("");

      return `
          <div class="modal-head">
              <div id="featureName"
                  class="modal-title-text"
                  contenteditable="true"
                  data-placeholder="New Feature Name">
                  ${esc(feature.name || "")}
              </div>
              <div class="spacer"></div>
              <button class="btn small soft" onclick="OL.closeModal()">Close</button>
          </div>
          <div class="modal-body">
              
              <label class="modal-section-label">Assigned Group</label>
              <select id="featureGroup" class="modal-textarea" style="min-height:auto;height:auto;">
                  <option value="">Unassigned</option>
                  <optgroup label="Fixed Categories">
                      ${groupOptions}
                  </optgroup>
                  <optgroup label="Functions">
                      ${functionOptions}
                  </optgroup>
              </select>
              
              <label class="modal-section-label">Notes (Optional)</label>
              <textarea id="featureNotes" class="modal-textarea">${esc(feature.notes || "")}</textarea>
              
          </div>
      `;
  }

  function bindFeatureModal(feature, isNew) {
      const layer = getModalLayer();
      if (!layer) return;

      let created = !feature._draft;

      const nameEl = layer.querySelector("#featureName");
      const groupEl = layer.querySelector("#featureGroup");
      const notesEl = layer.querySelector("#featureNotes");
      
      // --- Boilerplate Commit Logic ---
      function commitIfNeeded(val) {
          if (created || !val) return;
          created = true;
          delete feature._draft;
          state.features.push(feature);
          OL.persist();
          renderFeaturesGrid();
      }
      
      // --- Placeholder Logic (simplified for brevity) ---
      function updatePlaceholder(el) {
          el.dataset.empty = el.textContent.trim() === "" ? "true" : "false";
      }
      
      if (nameEl) {
          if (isNew) nameEl.textContent = "";

          nameEl.addEventListener("input", () => updatePlaceholder(nameEl));
          requestAnimationFrame(() => updatePlaceholder(nameEl));
          
          nameEl.addEventListener("blur", () => {
              const v = (nameEl.textContent || "").trim();
              if (!v) { feature.name = ""; return; }

              commitIfNeeded(v);
              feature.name = v;
              OL.persist();
              renderFeaturesGrid(); // Refresh the card display
          });
      }
      
      if (groupEl) {
          groupEl.onchange = () => {
              const val = groupEl.value;
              feature.functionId = null;
              feature.category = null;
              
              // Check if the value is a fixed category string or a Function ID
              const isCategory = ["General", "Security", "Integration"].includes(val);
              const isFunction = state.functions.some(fn => fn.id === val);
              
              if (isCategory) {
                  feature.category = val;
              } else if (isFunction) {
                  feature.functionId = val;
              }
              
              OL.persist();
              renderFeaturesGrid();
          };
      }

      if (notesEl) {
          notesEl.addEventListener("input", debounce(() => {
              feature.notes = notesEl.value;
              OL.persist();
          }, 200));
      }
  }

  // ------------------------------------------------------------------------------------

  OL.openFeatureModal = function (featureOrId, isNew = false) {
      let feature = typeof featureOrId === "string" 
          ? findFeatureById(featureOrId) 
          : featureOrId;

      if (!feature) {
          feature = { id: uid(), _draft: true, name: "", notes: "", category: null, functionId: null };
      }

      activeOnClose = null;
      openModal(renderFeatureModalHTML(feature));
      setTimeout(() => bindFeatureModal(feature, isNew), 0);
  };

  OL.deleteFeature = function (featureId) {
      const feature = findFeatureById(featureId);
      if (!feature) return;
      
      if (!confirm(`Delete feature "${feature.name}"? This will remove it from the Analysis matrix.`)) return;

      state.features = state.features.filter(f => f.id !== featureId);
      
      // CRITICAL: Also remove the feature from the Analysis Matrix data model
      OL.removeFeatureFromAnalysis(featureId); // This also calls persist/render matrix

      OL.persist();
      renderFeaturesGrid();
  };

  // ------------------------------------------------------------------------------------

  // ➡️ Action 5: Wire the Add Feature Button
  // Locate wireTopButtons (~ Line 10600 approx) and add this block:
  if (document.getElementById("btnAddFeature")) {
      document.getElementById("btnAddFeature").onclick = () => {
          const draftFeature = { id: uid(), _draft: true, name: "", notes: "", category: null, functionId: null };
          OL.openFeatureModal(draftFeature, true);
      };
  }

  //-------------------------------------------------------------
  // DATAPOINTS GRID (clean + hardened)
  // ------------------------------------------------------------
  // Function to update the Datapoints grid with grouping and custom sorting
  function renderDatapointsGrid() {
      const grid = document.getElementById("datapointsGrid");
      const sidebar = document.getElementById("datapointSidebarList");
      if (!grid || !sidebar) return;

      const data = state.datapoints || [];
      sidebar.innerHTML = "";
      grid.innerHTML = "";

      if (!data.length) {
          grid.innerHTML = `<div class="empty-hint">No datapoints defined.</div>`;
          return;
      }

      const norm = (v) => (typeof v === "string" ? v : v ? String(v) : "");

      // 1. Group data by objectType
      const grouped = data.reduce((acc, dp) => {
          const type = dp.objectType || "General";
          acc[type] = acc[type] || [];
          acc[type].push(dp);
          return acc;
      }, {});

      const sortedTypes = Object.keys(grouped).sort();

      // 2. Render Sidebar and Grid Sections
      sortedTypes.forEach((type) => {
          const typeId = `dp-group-${type.toLowerCase().replace(/\s+/g, '-')}`;
          
          // Add Link to Sidebar
          sidebar.insertAdjacentHTML("beforeend", `
              <div class="sidebar-item" onclick="document.getElementById('${typeId}').scrollIntoView({behavior: 'smooth'})">
                  <div class="sidebar-item-title">${type}</div>
                  <div class="sidebar-item-meta">${grouped[type].length} Datapoints</div>
              </div>
          `);

          // Add Heading with Anchor ID to Grid
          grid.insertAdjacentHTML("beforeend", `<h3 class="group-heading" id="${typeId}">${type}</h3>`);
          
          const groupContainer = document.createElement("div");
          groupContainer.className = "persona-flex-grid datapoint-group";
          groupContainer.setAttribute("data-object-type", type);

          // Sort items within group
          grouped[type].sort((a, b) => (a._sortIndex ?? 999) - (b._sortIndex ?? 999));

          grouped[type].forEach((dp) => {
              const mappings = state.apps.flatMap((app) =>
                  (app.datapointMappings || [])
                  .filter((m) => m.datapointId === dp.id)
                  .map((m) => ({ app, mapping: m })),
              );
              const mappedCount = mappings.length;

              const getTypeEmoji = (t) => {
                  const map = { 'Contact': '👤', 'Household': '🏠', 'Account': '💰', 'General': '📦' };
                  return map[t] || '📝';
              };

              const cardHtml = `
                  <div class="card datapoint-card" data-dp-id="${dp.id}" draggable="true">
                      <div class="card-header">
                          <div class="card-header-left">
                              <div class="card-title">${norm(dp.name) || "(Unnamed)"}</div>
                              <span class="dp-type-badge">${getTypeEmoji(dp.objectType)} ${dp.objectType || 'General'}</span>
                          </div>
                          <div class="card-close" onclick="event.stopPropagation(); OL.deleteDatapoint('${dp.id}')">×</div>
                      </div>
                      <div class="card-body">
                          <div class="card-section">
                              <div class="card-section-title">Description</div>
                              <div class="card-section-content single-line-text ${!dp.description ? "muted" : ""}">
                                  ${norm(dp.description) || "No description"}
                              </div>
                          </div>
                          <div class="card-section">
                              <div class="card-section-title">App Mappings</div>
                              <div class="card-section-content">
                                  ${mappedCount > 0 ? `${mappedCount} applications` : "<span class='muted'>Not mapped</span>"}
                              </div>
                          </div>
                      </div>
                  </div>
              `;
              groupContainer.insertAdjacentHTML("beforeend", cardHtml);
          });

          grid.appendChild(groupContainer);
      });

      // 3. Re-wire click events and drag-drop
      grid.querySelectorAll("[data-dp-id]").forEach((el) => {
          el.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              const dp = data.find(item => item.id === el.getAttribute("data-dp-id"));
              if (dp) OL.openDatapointModal(dp);
          };
      });

      if (typeof wireDatapointDragAndDrop === "function") {
          wireDatapointDragAndDrop(grid);
      }
  }

  // ------------------------------------------------------------
  // DATAPOINT DRAG AND DROP
  // ------------------------------------------------------------
  function wireDatapointDragAndDrop(grid) {
    let draggedDpId = null;
    const state = OL.state; // Access state globally or ensure OL.state is available

    // Helper to find datapoint by ID
    const findDatapoint = (id) => state.datapoints.find((dp) => dp.id === id);

    grid.querySelectorAll(".datapoint-card").forEach((card) => {
      card.addEventListener("dragstart", (e) => {
        draggedDpId = card.getAttribute("data-dp-id");
        e.dataTransfer.effectAllowed = "move";
        card.classList.add("dragging");
      });

      card.addEventListener("dragend", () => {
        draggedDpId = null;
        card.classList.remove("dragging");
        grid
          .querySelectorAll(".drop-target-area")
          .forEach((el) => el.classList.remove("drop-target-area"));
      });
    });

    // We now target the drop areas by both class names
    grid
      .querySelectorAll(".datapoint-card, .datapoint-group")
      .forEach((dropTarget) => {
        dropTarget.addEventListener("dragover", (e) => {
          if (!draggedDpId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";

          // Highlight the drop zone (either card or empty group container)
          if (dropTarget.classList.contains("datapoint-card")) {
            if (dropTarget.getAttribute("data-dp-id") === draggedDpId) return;
            dropTarget.classList.add("drop-target-area");
          } else if (dropTarget.classList.contains("datapoint-group")) {
            dropTarget.classList.add("drop-target-area");
          }
        });

        dropTarget.addEventListener("dragleave", () => {
          dropTarget.classList.remove("drop-target-area");
        });

        dropTarget.addEventListener("drop", (e) => {
          e.preventDefault();
          dropTarget.classList.remove("drop-target-area");
          if (!draggedDpId) return;

          const draggedDp = findDatapoint(draggedDpId);
          if (!draggedDp) return;

          let targetContainer, targetDp;

          if (dropTarget.classList.contains("datapoint-group")) {
            // Dropped onto an empty group container (or general container area)
            targetContainer = dropTarget;
            targetDp = null;
          } else if (dropTarget.classList.contains("datapoint-card")) {
            // Dropped onto another card (before/after logic)
            targetContainer = dropTarget.closest(".datapoint-group");
            targetDp = findDatapoint(dropTarget.getAttribute("data-dp-id"));
          } else {
            return;
          }

          // ⬇️ RENAMED: Use 'data-object-type' ⬇️
          const newObjectType =
            targetContainer.getAttribute("data-object-type");

          // 1. Update the objectType if necessary
          draggedDp.objectType = newObjectType; // ⬅️ UPDATED PROP NAME

          // 2. Calculate the new sort index
          // Get all siblings in the new group, excluding the dragged item
          const groupSiblings = state.datapoints
            .filter(
              (dp) => dp.objectType === newObjectType && dp.id !== draggedDpId,
            ) // ⬅️ UPDATED PROP NAME
            .sort((a, b) => (a._sortIndex ?? 0) - (b._sortIndex ?? 0));

          if (targetDp) {
            // Insert next to the target element
            const targetIndex = groupSiblings.findIndex(
              (dp) => dp.id === targetDp.id,
            );
            // Determine if we drop before or after the target card
            const isAfter =
              e.clientY - dropTarget.getBoundingClientRect().top >
              dropTarget.offsetHeight / 2;

            // Construct the new ordered list of DPs for the new group
            const newOrder = [];
            let inserted = false;

            groupSiblings.forEach((dp, i) => {
              if (i === targetIndex) {
                if (!isAfter) {
                  newOrder.push(draggedDp);
                  inserted = true;
                }
                newOrder.push(dp);
                if (isAfter) {
                  newOrder.push(draggedDp);
                  inserted = true;
                }
              } else {
                newOrder.push(dp);
              }
            });

            // Fail-safe: if the list was empty or the loop logic missed insertion (shouldn't happen with the logic above)
            if (!inserted) {
              newOrder.push(draggedDp);
            }

            // Write back new sort indices
            newOrder.forEach((dp, i) => {
              dp._sortIndex = i;
            });
          } else {
            // Dropped into the container, and targetDp is null
            // If the container has no existing cards, set index to 0
            if (
              targetContainer.querySelectorAll(".datapoint-card").length === 0
            ) {
              draggedDp._sortIndex = 0;
            } else {
              // Otherwise, treat it as appending to the end (if dragged to the non-card area)
              const newOrder = [...groupSiblings, draggedDp];
              newOrder.forEach((dp, i) => {
                dp._sortIndex = i;
              });
            }
          }

          OL.persist();
          renderDatapointsGrid();
        });
      });
  }
  // ------------------------------------------------------------
  // CANONICAL CAPABILITIES GRID
  // ------------------------------------------------------------

  function renderCanonicalCapModalHTML(cap, isNew = false) {
    return `
      <div class="modal-head">
        <div class="modal-title-text"
          id="capName"
          contenteditable="true"
          data-placeholder="New Canonical Capability">
          ${esc(cap.key || "")}
        </div>
        <div class="spacer"></div>
        <button class="btn small soft" onclick="OL.closeModal()">Close</button>
      </div>

      <div class="modal-body">

        <label class="modal-section-label">Key (unique identifier)</label>
        <input id="canonKey"
          class="modal-textarea"
          style="min-height:auto;height:auto;"
          data-placeholder="New Canonnical Capability"
          value="${esc(cap.key || "")}">

        <label class="modal-section-label">Type</label>
        <select id="canonType"
          class="modal-textarea"
          style="min-height:auto;height:auto;">
          <option value="trigger" ${(cap.type || "trigger") === "trigger" ? "selected" : ""}>Trigger</option>
          <option value="search" ${(cap.type || "") === "search" ? "selected" : ""}>Search</option>
          <option value="action" ${(cap.type || "") === "action" ? "selected" : ""}>Action</option>
        </select>

        <label class="modal-section-label">Notes</label>
        <textarea id="canonNotes" class="modal-textarea">${esc(cap.notes || "")}</textarea>

        <label class="modal-section-label">Used by capabilities</label>
        <div id="canonUsageTable">
          ${renderCanonicalUsageTable(cap)}
        </div>

      </div>
    `;
  }
  
  function bindCanonicalCapModal(cap, isNew) {
    const layer = getModalLayer();
    if (!layer) return;

    let created = !cap._draft;

    const nameEl = layer.querySelector("#capName");
    const keyEl = layer.querySelector("#canonKey");
    const typeEl = layer.querySelector("#canonType");
    const notesEl = layer.querySelector("#canonNotes");

    activeOnClose = () => {
        if (cap._draft) {
            renderCanonicalCapsGrid();
        }
    };

    function commitIfNeeded(val) {
        if (created || !val) return;
        created = true;
        delete cap._draft;

        state.canonicalCapabilities = state.canonicalCapabilities || [];
        state.canonicalCapabilities.push(cap);

        OL.persist();
        renderCanonicalCapsGrid();
    }

    // --- PLACEHOLDER LOGIC DEFINITION ---
    function updatePlaceholder(el) {
        // Use INNER HTML for a safer check in contenteditable
        const text = el.innerHTML || "";
        // If the element has *any* content (even if it contains HTML or NBSP) don't mark as empty
        el.dataset.empty = text.trim() === "" ? "true" : "false"; 
    }
    // ------------------------------------
    
    if (nameEl) {
        // --- NAME INITIALIZATION DEFENSE ---
        // CRITICAL: For existing items, manually set content to the stored value 
        // using innerHTML to ensure the placeholder doesn't immediately hide it.
        if (!isNew && cap.canonical) {
             nameEl.innerHTML = esc(cap.canonical); // Ensure we display the escaped string
        } else if (isNew) {
             nameEl.innerHTML = ""; // Clear for new drafts, as placeholder will take over
        }
        // --- END NAME INITIALIZATION DEFENSE ---

        // --- PLACEHOLDER ACTIVATION ---
        nameEl.addEventListener("input", () => {
            // Keep the cleanup logic merged with placeholder update
            if (nameEl.innerHTML === "<br>" || nameEl.textContent.trim() === "") {
                nameEl.innerHTML = "";
            }
            updatePlaceholder(nameEl);
        });
        
        // Initial paint check runs immediately
        requestAnimationFrame(() => updatePlaceholder(nameEl));
        // --- END PLACEHOLDER ACTIVATION ---

        // --- PERSISTENCE LOGIC (Unchanged) ---
        nameEl.addEventListener("blur", () => {
            // Use innerHTML for persistence to save any embedded tokens/formatting
            const v = (nameEl.innerHTML || "").trim();
            
            if (!v || v === "New Canonical Capability") {
                cap.canonical = ""; 
                OL.persist();
                return;
            }

            commitIfNeeded(v);
            cap.canonical = v;

            if (keyEl && !cap.canonical) keyEl.value = v;
            OL.persist();
            renderCanonicalCapsGrid();
        });

          nameEl.addEventListener("keydown", (e) => {
              if (e.key === "Enter") {
                  e.preventDefault();
                  nameEl.blur();
              }
          });
          
          // Clean stray <br> tags added by contenteditable (often needed on blur/input)
          nameEl.addEventListener("input", () => {
              if (nameEl.innerHTML === "<br>" || nameEl.textContent.trim() === "") {
                  nameEl.innerHTML = "";
              }
          });
      }

      if (keyEl) {
          keyEl.addEventListener("input",
              debounce(() => {
                  const v = keyEl.value.trim();
                  if (!cap._draft) {
                      cap.canonical = v;
                      OL.persist();
                      renderCanonicalCapsGrid();
                  } else {
                      cap.canonical = v;
                  }
              }, 200),
          );
      }

      if (typeEl) {
          typeEl.onchange = () => {
              cap.type = typeEl.value;
              if (!cap._draft) {
                  OL.persist();
                  renderCanonicalCapsGrid();
              }
          };
      }

      if (notesEl) {
          notesEl.addEventListener(
              "input",
              debounce(() => {
                  if (!cap._draft) {
                      cap.notes = notesEl.value;
                      OL.persist();
                  } else {
                      cap.notes = notesEl.value;
                  }
              }, 200),
          );
      }
  }
  function renderCanonicalCapsGrid() {
    const grid = document.getElementById("canonicalCapsGrid");
    if (!grid) return;

    const list = (state.canonicalCapabilities || [])
      .slice()
      .sort((a, b) =>
        (a.key || "").toLowerCase().localeCompare((b.key || "").toLowerCase()),
      );

    if (!list.length) {
      grid.innerHTML = `<div class="empty-hint">No canonical capabilities yet.</div>`;
      return;
    }

    grid.innerHTML = "";
    list.forEach((canon) => {
      const label =
        canon.key || canon.canonical || "(Unnamed canonical capability)";
      const type = canon.type || "";
      const notes = canon.notes || "";

      // how many concrete capabilities use this canonical id?
      const usageCount = (state.capabilities || []).filter(
        (cap) => cap.canonicalId === canon.id,
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
      `,
      );
    });
  }

  // show all capabilities that reference this canonical
  function renderCanonicalUsageTable(canon) {
    const rows = (state.capabilities || []).filter(
      (cap) => cap.canonicalId === canon.id,
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
                app?.name || "",
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

  OL.openCanonicalCapModal = function (capOrId, isNew = false) {
    let cap =
      typeof capOrId === "string"
        ? state.canonicalCapabilities.find((c) => c.id === capOrId)
        : capOrId;

    // if new → draft only, do NOT push to state yet
    if (!cap) {
      cap = {
        id: uid(),
        _draft: true,
        canonical: "",
        type: "trigger",
        notes: "",
        group: "",
      };
    }

    activeOnClose = null;
    openModal(renderCanonicalCapModalHTML(cap, isNew));
    bindCanonicalCapModal(cap, isNew);
  };

  OL.deleteCanonicalCapability = function (canonId) {
    const canon = (state.canonicalCapabilities || []).find(
      (c) => c.id === canonId,
    );
    if (!canon) return;

    const inUse = (state.capabilities || []).some(
      (cap) => cap.canonicalId === canonId,
    );
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
      (c) => c.id !== canonId,
    );

    OL.persist();
    renderCanonicalCapsGrid();
    renderCapabilitiesGrid();
  };

  //------------------------------------------------------------
  // TEAM MEMBERS AND Roles
  //------------------------------------------------------------
  function renderTeamMembersGrid() {
    const grid = document.getElementById("teamMembersGrid");
    if (!grid) return;

    const members = Array.isArray(state.teamMembers)
      ? state.teamMembers.slice()
      : [];
    if (!members.length) {
      grid.innerHTML = `<div class="empty-hint">No team members yet.</div>`;
      return;
    }

    members.sort((a, b) =>
      (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()),
    );

    grid.innerHTML = "";
    members.forEach((member) => {
      grid.insertAdjacentHTML("beforeend", renderTeamMemberCard(member));
    });
  }

  function renderTeamMemberCard(member) {
    const roles = (member.roles || [])
      .map((r) => findTeamRoleById(r.roleId))
      .filter(Boolean);

    const rolePills = roles.length
      ? roles
          .map(
            (role) => `
            <span
              class="pill fn"
              oncontextmenu="OL.removeRoleFromMember(event, '${member.id}', '${role.id}')"
              onclick="event.stopPropagation(); OL.openTeamRoleModal('${role.id}')"  >
              ${esc(role.name || "")}
            </span>
          `,
          )
          .join("")
      : `<span class="pill muted">No roles assigned</span>`;

    const subtitleParts = [];
    if (member.title) subtitleParts.push(member.title);
    if (member.email) subtitleParts.push(member.email);
    const subtitle = subtitleParts.join(" • ");

    return `
      <div class="card" data-team-member-id="${member.id}" onclick="OL.openTeamMemberModal('${member.id}')">
        <div class="card-header">
          <div class="card-header-left">
            <div class="card-icon">${OL.iconHTML(member)}</div>
            <div>
              <div class="card-title">${esc(member.name || "")}</div>
              ${
                subtitle
                  ? `<div class="card-subtitle single-line-text">${esc(subtitle)}</div>`
                  : ""
              }
            </div>
          </div>
          <div
            class="card-close"
            onclick="event.stopPropagation(); OL.deleteTeamMember('${member.id}')"
          >×</div>
        </div>
        <div class="card-body">
          <div class="card-section">
            <div class="card-section-title">Roles</div>
            <div class="card-section-content">
              <div class="pills-row">
                ${rolePills}
              </div>
            </div>
          </div>
          <div class="card-section">
            <div class="card-section-title">Notes</div>
            <div class="card-section-content single-line-text ${
              member.notes ? "" : "muted"
            }">
              ${esc(member.notes || "No notes")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderTeamRolesGrid() {
    const grid = document.getElementById("teamRolesGrid");
    if (!grid) return;

    const roles = Array.isArray(state.teamRoles) ? state.teamRoles.slice() : [];
    if (!roles.length) {
      grid.innerHTML = `<div class="empty-hint">No roles yet.</div>`;
      return;
    }

    roles.sort((a, b) =>
      (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()),
    );

    grid.innerHTML = "";
    roles.forEach((role) => {
      grid.insertAdjacentHTML("beforeend", renderTeamRoleCard(role));
    });
  }

  function renderTeamRoleCard(role) {
    const assignments = teamAssignmentsForRole(role.id);
    const memberPills = assignments.length
      ? assignments
          .map(
            ({ member }) => `
            <span
              class="pill fn"
              onclick="event.stopPropagation(); OL.openTeamMemberModal('${member.id}')"
            >
              ${esc(member.name || "")}
            </span>
          `,
          )
          .join("")
      : `<span class="pill muted">No members with this role</span>`;

    return `
      <div class="card" data-team-role-id="${role.id}" 
        onclick="OL.openTeamRoleModal('${role.id}')">
        <div class="card-header">
          <div class="card-header-left">
            <div class="card-title">${esc(role.name || "")}</div>
          </div>
          <div
            class="card-close"
            onclick="event.stopPropagation(); OL.deleteTeamRole('${role.id}')"
          >×</div>
        </div>
        <div class="card-body">
          <div class="card-section">
            <div class="card-section-title">Description</div>
            <div class="card-section-content single-line-text ${
              role.description ? "" : "muted"
            }">
              ${esc(role.description || "No description")}
            </div>
          </div>
          <div class="card-section">
            <div class="card-section-title">Members</div>
            <div class="card-section-content">
              <div class="pills-row">
                ${memberPills}
              </div>
            </div>
          </div>
          <div class="card-section">
            <div class="card-section-title">Notes</div>
            <div class="card-section-content single-line-text ${
              role.notes ? "" : "muted"
            }">
              ${esc(role.notes || "No notes")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------
  // SEGMENT CATEGORIES GRID
  // ------------------------------------------------------------
  function renderUnifiedSegmentBuilder() {
      const mainArea = document.getElementById("mainContent"); 
      if (!mainArea) return;

      let unifiedSection = document.getElementById("section-unified-segments");
      
      if (!unifiedSection) {
          // We inject a layout that uses FLEX-ROW and unique class names
          mainArea.insertAdjacentHTML('beforeend', `
              <div id="section-unified-segments" class="unified-row-layout">
                  <aside class="logic-sidebar">
                      <div class="sidebar-fixed-content">
                          <div class="sidebar-header">
                              <h3>Logic Categories</h3>
                          </div>
                          <button class="btn-sidebar-add" id="btnUnifiedAddCategory">+ New Category</button>
                          <div id="sidebarCategoryList"></div>
                      </div>
                  </aside>
                  
                  <main class="persona-canvas">
                      <div class="canvas-header-row">
                          <h2>Segment Personas</h2>
                          <button class="btn small primary" id="btnUnifiedAddPersona">+ New Persona</button>
                      </div>
                      <div id="personaGrid" class="persona-wrap-container"></div>
                  </main>
              </div>
          `);
          unifiedSection = document.getElementById("section-unified-segments");
          wireUnifiedSegmentButtons();
      }

      const isSegments = location.hash.startsWith("#/settings/segments");
      
      if (isSegments) {
          document.body.classList.add("is-segments-page");
          unifiedSection.style.display = "flex";
          renderSidebarCategories();
          renderPersonaGrid();
      } else {
          document.body.classList.remove("is-segments-page");
          unifiedSection.style.display = "none";
      }
  }
  // 🛠️ Helper to prevent the "null" errors in sub-renderers
  function renderSidebarCategories() {
      const list = document.getElementById("sidebarCategoryList");
      if (!list) return; // Silent exit if DOM isn't ready

      list.innerHTML = (state.segmentCategories || []).map(cat => `
          <div class="sidebar-item" onclick="OL.openSegmentCategoriesModal('${cat.id}')">
              <div class="sidebar-item-title">${esc(cat.name)}</div>
              <div class="sidebar-item-meta">${(cat.values || []).length} values defined</div>
          </div>
      `).join('');
  }

  function renderPersonaGrid() {
      const grid = document.getElementById("personaGrid");
      if (!grid) return;

      grid.innerHTML = (state.segments || []).map(seg => {
          const activeRules = (seg.rules || []).filter(r => r.valueId);
          return `
              <div class="card segment-persona-card">
                  <div class="card-header">
                      <div class="card-title" contenteditable="true" onblur="OL.renameSegment('${seg.id}', this.textContent)">
                          ${esc(seg.name)}
                      </div>
                      <div class="card-close" onclick="OL.deleteSegment('${seg.id}')">×</div>
                  </div>
                  <div class="card-body">
                      <div class="card-section">
                          <div class="pill-stack">
                              ${activeRules.map(r => renderRulePill(seg, r)).join('')}
                              <button class="btn-add-pill" onclick="OL.addRuleToSegment('${seg.id}')">+ Add Filter</button>
                          </div>
                      </div>
                  </div>
              </div>`;
      }).join('');
  }

  // 🛠️ Dedicated Button Wiring for the Unified Section
  function wireUnifiedSegmentButtons() {
      const btnCat = document.getElementById("btnUnifiedAddCategory");
      if (btnCat) {
          btnCat.onclick = (e) => {
              e.stopPropagation();
              const cat = { id: uid(), name: "New Category", values: [], _draft: true };
              state.segmentCategories.push(cat);
              OL.persist();
              renderUnifiedSegmentBuilder();
              setTimeout(() => OL.openSegmentCategoriesModal(cat.id), 50);
          };
      }

      const btnPersona = document.getElementById("btnUnifiedAddPersona");
      if (btnPersona) {
          btnPersona.onclick = (e) => {
              e.stopPropagation();
              const seg = { id: uid(), name: "New Persona", rules: [], description: "" };
              state.segments.push(seg);
              OL.persist();
              renderUnifiedSegmentBuilder();
          };
      }
  }

  function renderRulePill(seg, rule) {
      const cat = state.segmentCategories.find(c => c.id === rule.categoryId);
      const val = cat?.values.find(v => v.id === rule.valueId);
      if (!cat || !val) return '';

      return `
          <div class="rule-pill">
              <span class="rule-pill-label">${esc(cat.name)}:</span>
              <span class="rule-pill-value" onclick="OL.changeRuleValue('${seg.id}', '${cat.id}')">${esc(val.label)}</span>
              <span class="rule-pill-remove" onclick="OL.removeRule('${seg.id}', '${cat.id}')">×</span>
          </div>
      `;
  }

  // --- Persona Logic Actions ---

  /**
   * Updates the name of a persona segment.
   */
  OL.renameSegment = function(id, newName) {
      const seg = state.segments.find(s => s.id === id);
      if (seg) {
          seg.name = (newName || "").trim();
          OL.persist();
          // Silent update to background grid if needed
          renderPersonaGrid();
      }
  };

  /**
   * Deletes a persona segment after confirmation.
   */
  OL.deleteSegment = function(id) {
      const seg = state.segments.find(s => s.id === id);
      if (!seg) return;
      
      if (confirm(`Delete persona "${seg.name}"?`)) {
          state.segments = state.segments.filter(s => s.id !== id);
          OL.persist();
          renderPersonaGrid();
      }
  };

  /**
   * Removes a specific criteria rule from a persona.
   */
  OL.removeRule = function(segmentId, categoryId) {
      const seg = state.segments.find(s => s.id === segmentId);
      if (seg) {
          seg.rules = (seg.rules || []).filter(r => r.categoryId !== categoryId);
          OL.persist();
          renderPersonaGrid();
      }
  };

  /**
   * Opens a dropdown to change the value of an existing rule.
   */
  OL.changeRuleValue = function(segmentId, categoryId) {
      const seg = state.segments.find(s => s.id === segmentId);
      const cat = state.segmentCategories.find(c => c.id === categoryId);
      if (!seg || !cat) return;

      // Use your existing dropdown utility to pick a new value
      openMappingDropdown({
          anchorEl: event.currentTarget,
          options: cat.values.map(v => ({ id: v.id, label: v.label })),
          allowMultiple: false,
          onSelect: (newValId) => {
              const rule = seg.rules.find(r => r.categoryId === categoryId);
              if (rule) {
                  rule.valueId = newValId;
                  OL.persist();
                  renderPersonaGrid();
              }
          }
      });
  };

  OL.addRuleToSegment = function(segmentId) {
      const segment = state.segments.find(s => s.id === segmentId);
      const btn = event.currentTarget;

      const categoryOptions = state.segmentCategories.map(cat => ({
          id: cat.id,
          label: cat.name
      }));

      openMappingDropdown({
          anchorEl: btn,
          options: categoryOptions,
          allowMultiple: false,
          onSelect: (catId) => {
              const selectedCat = state.segmentCategories.find(c => c.id === catId);
              setTimeout(() => {
                  openMappingDropdown({
                      anchorEl: btn,
                      options: selectedCat.values.map(v => ({ id: v.id, label: v.label })),
                      allowMultiple: false,
                      onSelect: (valId) => {
                          segment.rules = segment.rules || [];
                          const existing = segment.rules.find(r => r.categoryId === catId);
                          if (existing) existing.valueId = valId;
                          else segment.rules.push({ categoryId: catId, valueId: valId });

                          OL.persist();
                          renderPersonaGrid();
                      }
                  });
              }, 50);
          }
      });
  };

  OL.openSegmentCategoriesModal = function(catId) {
      const cat = state.segmentCategories.find(c => c.id === catId);
      if (!cat) return;

      const valuesHTML = (cat.values || []).map(v => `
          <div class="pill outcome-pill" style="margin: 4px;">
              <span contenteditable="true" onblur="OL.renameCategoryValue('${cat.id}', '${v.id}', this.textContent)">${esc(v.label)}</span>
              <span class="remove-zone-btn" onclick="OL.deleteCategoryValue('${cat.id}', '${v.id}')">×</span>
          </div>
      `).join('');

      openModal(`
          <div class="modal-head">
              <div class="modal-title-text" contenteditable="true" onblur="OL.renameCategory('${cat.id}', this.textContent)">
                  ${esc(cat.name)}
              </div>
              <div class="spacer"></div>
              <button class="btn small soft" onclick="OL.closeModal()">Close</button>
          </div>
          <div class="modal-body">
              <label class="modal-section-label">Category Values</label>
              <div class="modal-pill-box" style="margin-bottom: 15px;">
                  ${valuesHTML || '<div class="empty-hint">No values defined yet.</div>'}
              </div>
              <button class="btn small primary" onclick="OL.addValueToCategory('${cat.id}')">+ Add Value</button>
              
              <div style="margin-top: 30px; border-top: 1px solid var(--line); padding-top: 20px;">
                  <button class="btn small warn" onclick="OL.deleteSegmentCategory('${cat.id}')">Delete Entire Category</button>
              </div>
          </div>
      `);
  };

  OL.addValueToCategory = function(catId) {
      const label = prompt("Enter value name (e.g. 'Retiree', 'High Net Worth'):");
      if (!label) return;
      
      const cat = state.segmentCategories.find(c => c.id === catId);
      cat.values.push({ id: uid(), label: label.trim() });
      
      OL.persist();
      OL.openSegmentCategoriesModal(catId); // Refresh modal
      renderUnifiedSegmentBuilder(); // Refresh sidebar
  };

  OL.deleteCategoryValue = function(catId, valId) {
      if (!confirm("Delete this value? Rules using it will be cleared.")) return;
      const cat = state.segmentCategories.find(c => c.id === catId);
      cat.values = cat.values.filter(v => v.id !== valId);
      
      // Cleanup rules in personas
      state.segments.forEach(seg => {
          seg.rules = (seg.rules || []).filter(r => r.valueId !== valId);
      });
      
      OL.persist();
      OL.openSegmentCategoriesModal(catId);
      renderUnifiedSegmentBuilder();
  };

  OL.renameCategory = function(id, newName) {
      const cat = state.segmentCategories.find(c => c.id === id);
      if (cat) {
          cat.name = (newName || "").trim();
          OL.persist();
          renderSidebarCategories();
          renderPersonaGrid(); // Update cards to show new category name
      }
  };

  OL.deleteSegmentCategory = function(id) {
      const cat = state.segmentCategories.find(c => c.id === id);
      if (!cat) return;
      
      if (confirm(`Delete entire category "${cat.name}"? This will clear all related filters in your personas.`)) {
          state.segmentCategories = state.segmentCategories.filter(c => c.id !== id);
          
          // Clean up all personas using this category
          state.segments.forEach(seg => {
              seg.rules = (seg.rules || []).filter(r => r.categoryId !== id);
          });
          
          OL.persist();
          OL.closeModal(); // Close the category edit modal
          renderUnifiedSegmentBuilder();
      }
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

      grid.innerHTML = typeOrder
        .map((type) => {
          const map = groupsByType[type];
          if (!map || !map.size) return "";

          const cards = Array.from(map.values())
            .sort((a, b) =>
              a.canonical
                .toLowerCase()
                .localeCompare(b.canonical.toLowerCase()),
            )
            .map((group) => {
              // ... (unchanged logic to build a single card) ...

              const apps = group.caps
                .map((cap) => findAppById(cap.appId))
                .filter(Boolean)
                .map((app) => app.name);
              // 1. Collect unique App objects, not just names, so we have the ID for linking
              const uniqueAppObjs = [];
              const seenAppNames = new Set();

              group.caps
                  .map((cap) => findAppById(cap.appId))
                  .filter(Boolean) // Filter out null/undefined apps
                  .forEach((app) => {
                      if (!seenAppNames.has(app.name)) {
                          seenAppNames.add(app.name);
                          uniqueAppObjs.push(app);
                      }
                  });

              // 2. Map the App Objects to linked Pill HTML
              const appPillsWithLinks = uniqueAppObjs.length
                  ? uniqueAppObjs
                      .map((app) => `
                          <span 
                              class="pill integr"
                              onclick="event.stopPropagation(); OL.openAppModal('${app.id}')">
                              ${esc(app.name)}
                          </span>
                      `)
                      .join("")
                  : null; // Set to null/undefined if empty for easier check below

              // Then, replace the inline rendering logic inside the HTML template block:
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
                                  ${appPillsWithLinks || '<span class="pill muted">No apps linked</span>'}
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

          // ⬇️ NEW COLUMN WRAPPER ⬇️
          return `
          <div class="cap-type-column">
            <h3 class="cap-type-heading">${labels[type]}</h3>
            <div class="cards-grid">
              ${cards}
            </div>
          </div>
        `;
          // ⬆️ END COLUMN WRAPPER ⬆️
        })
        .join("");
    });
  }
  // ------------------------------------------------------------
  // FOLDER Hierarchy
  // ------------------------------------------------------------

  // helper: children by parent
  function folderChildren(nodes, parentId) {
    return (nodes || [])
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => {
        const sa = typeof a.sort === "number" ? a.sort : 0;
        const sb = typeof b.sort === "number" ? b.sort : 0;
        if (sa !== sb) return sa - sb;
        return (a.name || "")
          .toLowerCase()
          .localeCompare((b.name || "").toLowerCase());
      });
  }

  function deleteFolderNode(hier, nodeId) {
    const nodes = hier.nodes || [];
    const toDelete = new Set([nodeId]);

    // collect descendants
    let changed = true;
    while (changed) {
      changed = false;
      nodes.forEach((n) => {
        if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
          toDelete.add(n.id);
          changed = true;
        }
      });
    }

    hier.nodes = nodes.filter((n) => !toDelete.has(n.id));
  }

  // Build HTML for the tree
  function renderFolderNodesHTML(hier) {
    const nodes = Array.isArray(hier.nodes) ? hier.nodes : [];
    if (!nodes.length) {
      return `<div class="empty-hint">No folders yet. Use “+ Top-Level Folder” to start.</div>`;
    }

    function walk(parentId, depth) {
      const children = folderChildren(nodes, parentId);
      if (!children.length) return "";

return children
  .map((n) => {
    const indent = 8 + depth * 18;
    // Determine if the node can be moved up a level (cannot move up if it's a top-level folder)
    const canMoveUp = n.parentId !== null;
    
      return `
        <div class="folder-node-row"
          draggable="true"
          data-hier-id="${hier.id}"
          data-node-id="${n.id}">
          <div class="folder-node-main" style="padding-left:${indent}px;">
            <span class="folder-node-icon">📁</span>
            <div 
              class="folder-node-label" 
              contenteditable="true"
              data-node-id="${n.id}" 
              data-placeholder="Folder Name">
              ${esc(n.name || "")}
            </div>
            
            <span class="spacer"></span>
            
            <div class="folder-actions">
              <button class="btn xsmall soft folder-outdent" ${!canMoveUp ? 'disabled' : ''}><</button>
              
              <button class="btn xsmall soft folder-indent" disabled>></button>
              
              <button class="btn xsmall soft folder-add-child">+ Subfolder</button>
            </div>
            
            <span class="card-close folder-delete">×</span>
          </div>
        </div>
        ${walk(n.id, depth + 1)}
      `;
    })
    .join("");
    }

    return walk(null, 0);
  }

  let folderDragState = null;

  function renderFolderHierarchyGrid() {
      const grid = document.getElementById("folderHierarchyGrid");
      if (!grid) return;

      const list = Array.isArray(state.folderHierarchy)
          ? state.folderHierarchy
          : [];

      if (!list.length) {
          grid.innerHTML = `<div class="empty-hint">No folder hierarchy defined yet.</div>`;
          return;
      }

      grid.innerHTML = "";

      const sorted = [...list].sort((a, b) =>
          (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()),
      );

      sorted.forEach((hier) => {
          grid.insertAdjacentHTML(
              "beforeend",
              `
              <div class="card" 
                  data-hier-id="${hier.id}" 
                  onclick="OL.openFolderHierarchyModal('${hier.id}')"> <div class="card-header">
                      <div class="card-header-left">
                          <div class="card-title">${esc(hier.name || "")}</div>
                      </div>
                      <div class="card-close folder-hier-delete"
                          onclick="event.stopPropagation(); OL.deleteFolderHierarchy('${hier.id}')">×</div>
                  </div>
                  
                  <div class="card-body">
                      <div class="card-section">
                          <div class="card-section-title">Description</div>
                          <div class="card-section-content single-line-text ${!hier.description ? "muted" : ""}">
                              ${esc(hier.description || "Click to view/edit structure")}
                          </div>
                      </div>
                  </div>
              </div>
              `,
          );
      });

      // --- Wiring remains for non-modal elements (delete button on card) ---
      grid.querySelectorAll(".folder-hier-delete").forEach(delBtn => {
          delBtn.onclick = (e) => {
              e.stopPropagation();
              const hierId = delBtn.closest("[data-hier-id]").getAttribute("data-hier-id");
              OL.deleteFolderHierarchy(hierId);
          };
      });
  }

  // NOTE: You need a new OL.deleteFolderHierarchy function:
  OL.deleteFolderHierarchy = function (hierId) {
      const hier = state.folderHierarchy.find(h => h.id === hierId);
      if (!hier) return;
      if (!confirm(`Delete folder hierarchy "${hier.name || "this hierarchy"}"?`)) return;
      
      state.folderHierarchy = state.folderHierarchy.filter(h => h.id !== hierId);
      OL.persist();
      renderFolderHierarchyGrid();
  };

  // --- NEW HELPER FOR MODAL TREE RENDERING ---
// NOTE: This logic is now purely for display inside the modal body
function renderFolderTreeRecursive(hier, parentId, depth = 0) {
    const nodes = Array.isArray(hier.nodes) ? hier.nodes : [];
    const children = folderChildren(nodes, parentId);
    
    if (children.length === 0) {
        if (parentId === null) {
             return `<div class="empty-hint">No top-level folders yet.</div>`;
        }
        return '';
    }

    return children
        .map((n) => {
            const indent = depth * 20;
            const canMoveUp = n.parentId !== null;
            
            // Determine if there is a previous sibling to indent under
            const siblings = nodes.filter(x => x.parentId === n.parentId).sort((a, b) => a.sort - b.sort);
            const targetIndex = siblings.findIndex(x => x.id === n.id);
            const canMoveDown = targetIndex > 0; // Can only indent if there is a preceding sibling

            return `
                <div class="folder-node-row"
                    data-hier-id="${hier.id}"
                    data-node-id="${n.id}">
                    <div class="folder-node-main" style="padding-left:${indent}px;">
                        <span class="folder-node-icon">📁</span>
                        
                        <div 
                            class="folder-node-label" 
                            contenteditable="true"
                            data-placeholder="Folder Name">
                            ${n.name || ""} 
                        </div>
                        
                        <span class="spacer"></span>
                        
                        <div class="folder-actions">
                            <button class="btn xsmall soft folder-outdent" ${!canMoveUp ? 'disabled' : ''}><</button>
                            <button class="btn xsmall soft folder-indent" data-prev-sibling="${canMoveDown ? siblings[targetIndex-1].id : ''}" ${!canMoveDown ? 'disabled' : ''}>></button>
                            <button class="btn xsmall soft folder-add-child">+ Subfolder</button>
                        </div>
                        
                        <span class="card-close folder-delete">×</span>
                    </div>
                </div>
                ${renderFolderTreeRecursive(hier, n.id, depth + 1)}
            `;
        })
        .join("");
  }

  // --- MODAL HTML RENDERER ---
  function renderFolderHierarchyModalHTML(hier) {
      return `
          <div class="modal-head">
              <div id="hierName"
                  class="modal-title-text"
                  contenteditable="true"
                  data-placeholder="New Folder Hierarchy">
                  ${esc(hier.name || "")}
              </div>
              <div class="spacer"></div>
              <button class="btn small soft" onclick="OL.closeModal()">Close</button>
          </div>

          <div class="modal-body">
              
              <div>
                  <label class="modal-section-label">Description</label>
                  <textarea id="hierDesc" class="modal-textarea">${esc(hier.description || "")}</textarea>
              </div>
              
              <div>
                  <label class="modal-section-label">Folder Tree Structure</label>
                  <div class="folder-tree-modal-wrap">
                      <div class="folder-tree" id="modalFolderTree">
                          ${renderFolderTreeRecursive(hier, null)}
                      </div>
                      
                      <button class="btn small soft folder-add-root" style="margin-top: 10px;">
                          + Top-Level Folder
                      </button>
                  </div>
              </div>
          </div>
      `;
  }

  // --- MODAL OPENER ---
  OL.openFolderHierarchyModal = function (hierId) {
      const hier = state.folderHierarchy.find(h => h.id === hierId);
      if (!hier) return;

      activeOnClose = null;
      openModal(renderFolderHierarchyModalHTML(hier));
      setTimeout(() => bindFolderHierarchyModal(hier), 0);
      renderFolderHierarchyGrid();
  };

  // --- MODAL BINDER (Contains all the old wiring for editing) ---
  function bindFolderHierarchyModal(hier) {
      const layer = getModalLayer();
      if (!layer) return;

      const nameEl = layer.querySelector("#hierName");
      const descEl = layer.querySelector("#hierDesc");
      const addRootBtn = layer.querySelector(".folder-add-root");

      // 1. Hierarchy Name Editing
      if (nameEl) {
          nameEl.addEventListener("blur", () => {
              hier.name = nameEl.textContent.trim() || "New Folder Hierarchy";
              OL.persist();
              renderFolderHierarchyGrid();
          });
      }

      // 2. Description Editing
      if (descEl) {
          descEl.addEventListener("input", debounce(() => {
              hier.description = descEl.value;
              OL.persist();
              renderFolderHierarchyGrid();
          }, 200));
      }

      // 3. Add Root Button Logic
      if (addRootBtn) {
          addRootBtn.onclick = (e) => {
              e.stopPropagation();
              const label = prompt("New top-level folder name?");
              if (!label) return;
              
              hier.nodes = hier.nodes || [];
              const siblings = hier.nodes.filter((n) => n.parentId == null);
              const maxSort = siblings.reduce((m, n) => (typeof n.sort === "number" && n.sort > m ? n.sort : m), -1) + 1;

              hier.nodes.push({
                  id: OL.utils.uid(),
                  name: label.trim(),
                  parentId: null,
                  sort: maxSort,
              });

              OL.persist();
              // Refresh modal and grid
              bindFolderHierarchyModal(hier);
              const modalTree = layer.querySelector("#modalFolderTree");
              if (modalTree) modalTree.innerHTML = renderFolderTreeRecursive(hier, null);
              renderFolderHierarchyGrid();
          };
      }

      // 4. Node-Level Actions (Loop through each row)
      layer.querySelectorAll(".folder-node-row").forEach((row) => {
          const nodeId = row.getAttribute("data-node-id");
          const node = (hier.nodes || []).find((n) => n.id === nodeId);
          if (!node) return;

          const labelEl = row.querySelector(".folder-node-label");
          const addChildBtn = row.querySelector(".folder-add-child"); // Defined here
          const outdentBtn = row.querySelector(".folder-outdent");
          const indentBtn = row.querySelector(".folder-indent");
          const deleteBtn = row.querySelector(".folder-delete");

          // --- SUBFOLDER LOGIC (FIXES REFERENCE ERROR) ---
          if (addChildBtn) {
              addChildBtn.onclick = (e) => {
                  e.stopPropagation();
                  const label = prompt("New subfolder name?");
                  if (!label) return;

                  hier.nodes = hier.nodes || [];
                  const siblings = hier.nodes.filter((n) => n.parentId === node.id);
                  const maxSort = siblings.reduce((m, n) => (typeof n.sort === "number" && n.sort > m ? n.sort : m), -1) + 1;

                  hier.nodes.push({
                      id: OL.utils.uid(),
                      name: label.trim(),
                      parentId: node.id,
                      sort: maxSort,
                  });

                  OL.persist();
                  // Refresh modal view and re-bind
                  const modalTree = layer.querySelector("#modalFolderTree");
                  if (modalTree) modalTree.innerHTML = renderFolderTreeRecursive(hier, null);
                  bindFolderHierarchyModal(hier); 
                  renderFolderHierarchyGrid();
              };
          }

          // Inline Folder Rename
          if (labelEl) {
              labelEl.addEventListener("blur", () => {
                  node.name = labelEl.innerText.trim();
                  OL.persist();
                  renderFolderHierarchyGrid();
              });
          }

          // Outdent
          if (outdentBtn && !outdentBtn.disabled) {
              outdentBtn.onclick = (e) => {
                  e.stopPropagation();
                  const parentNode = hier.nodes.find(n => n.id === node.parentId);
                  node.parentId = parentNode ? parentNode.parentId : null;
                  OL.persist();
                  const modalTree = layer.querySelector("#modalFolderTree");
                  if (modalTree) modalTree.innerHTML = renderFolderTreeRecursive(hier, null);
                  bindFolderHierarchyModal(hier);
                  renderFolderHierarchyGrid();
              };
          }

          // Indent (Move down a level under the previous sibling)
          if (indentBtn && !indentBtn.disabled) {
              indentBtn.onclick = (e) => {
                  e.stopPropagation();
                  
                  // 1. Get all nodes at the same level as this one
                  const siblings = hier.nodes.filter(n => n.parentId === node.parentId)
                    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
                  
                  // 2. Find this node's index among those siblings
                  const idx = siblings.findIndex(n => n.id === node.id);
                  
                  // 3. The "target" parent is the sibling immediately above it
                  if (idx > 0) {
                      const newParent = siblings[idx - 1];
                      node.parentId = newParent.id;
                      node.sort = 999; // Move to the bottom of the new parent's list
                      
                      OL.persist();
                      
                      // 4. Refresh both the Modal and the Grid Card
                      const modalTree = layer.querySelector("#modalFolderTree");
                      if (modalTree) modalTree.innerHTML = renderFolderTreeRecursive(hier, null);
                      bindFolderHierarchyModal(hier); 
                      renderFolderHierarchyGrid();
                  }
              };
          }

          // Delete
          if (deleteBtn) {
              deleteBtn.onclick = (e) => {
                  e.stopPropagation();
                  if (!confirm("Delete this folder and all sub-folders?")) return;
                  deleteFolderNode(hier, node.id);
                  OL.persist();
                  const modalTree = layer.querySelector("#modalFolderTree");
                  if (modalTree) modalTree.innerHTML = renderFolderTreeRecursive(hier, null);
                  bindFolderHierarchyModal(hier);
                  renderFolderHierarchyGrid();
              };
          }
      });

      OL.injectDatapointButtonToActiveModal();
  }

  // ------------------------------------------------------------
  // NAMING CONVENTIONS (Unified Model)
  // ------------------------------------------------------------

  function renderNamingConventions() {
      const section = document.getElementById("section-naming-conventions");
      const grid = document.getElementById("namingGrid");
      if (!section || !grid) return;

      const isNaming = location.hash.startsWith("#/settings/naming");

      if (isNaming) {
          section.style.display = "block";
          grid.innerHTML = ""; 

          // Always pull fresh from the global state
          const list = window.OL.state.namingConventions || [];

          list.forEach(nc => {
              // Call the fixed helper function
              renderNamingCardToGrid(nc); 
          });

          // Wire any additional visualizer buttons
          OL.injectDatapointButtonToActiveModal(); 
      } else {
          section.style.display = "none";
      }
  }
  
  function renderNamingCardToGrid(nc) {
      const grid = document.getElementById("namingGrid");
      if (!grid) return;

      const activeRules = (nc.rules || []).filter(r => r.valueId);

      const cardHtml = `
          <div class="card segment-persona-card naming-card">
              <div class="card-header">
                  <div class="card-title" contenteditable="true" 
                      onblur="OL.renameNamingScenario('${nc.id}', this.textContent)">
                      ${esc(nc.name || "New Scenario")}
                  </div>
                  <div class="card-close" onclick="OL.deleteNamingScenario('${nc.id}')">×</div>
              </div>
              <div class="card-body">
                  <div class="pill-stack">
                      ${activeRules.map(rule => renderNamingRulePill(nc, rule)).join('')}
                      <button class="btn-add-pill" onclick="OL.addRuleToNaming('${nc.id}')">
                          + Add Pattern
                      </button>
                  </div>
              </div>
          </div>
      `;
      grid.insertAdjacentHTML("beforeend", cardHtml);
  }

  function renderNamingCardToGrid(nc) {
      const grid = document.getElementById("namingGrid");
      if (!grid) return;

      const cardHtml = `
          <div class="card segment-persona-card naming-card">
              <div class="card-header">
                  <div class="card-title" contenteditable="true" 
                      onblur="OL.renameNamingScenario('${nc.id}', this.textContent)">
                      ${esc(nc.name || "New Scenario")}
                  </div>
                  <div class="card-close" onclick="OL.deleteNamingScenario('${nc.id}')">×</div>
              </div>
              <div class="card-body">
                  <div class="pill-stack">
                      ${(nc.rules || []).map(rule => renderNamingRuleRow(nc, rule)).join('')}
                  </div>
              </div>
          </div>
      `;
      grid.insertAdjacentHTML("beforeend", cardHtml);
  }

  function renderNamingRuleRow(nc, rule) {
      const cat = state.namingCategories.find(c => c.id === rule.categoryId);
      const val = cat?.values.find(v => v.id === rule.valueId);
      
      // If no value is selected, show a prompt
      const displayValue = val ? esc(val.label) : `<span class="muted">Select Pattern...</span>`;

      return `
          <div class="rule-pill naming-rule-row" style="display:flex; justify-content:space-between; margin-bottom:8px;">
              <span class="rule-pill-label" style="font-weight:600;">${esc(cat ? cat.name : "Unknown")}:</span>
              <span class="rule-pill-value clickable-value" 
                    style="cursor:pointer; color:var(--accent);"
                    onclick="OL.changeNamingRuleValue('${nc.id}', '${rule.categoryId}')">
                  ${displayValue}
              </span>
          </div>
      `;
  }

  function renderNamingRulePill(nc, rule) {
      const cat = state.namingCategories.find(c => c.id === rule.categoryId);
      const val = cat?.values.find(v => v.id === rule.valueId);
      if (!cat || !val) return '';

      return `
          <div class="rule-pill">
              <span class="rule-pill-label">${esc(cat.name)}:</span>
              <span class="rule-pill-value" onclick="OL.changeNamingRuleValue('${nc.id}', '${cat.id}')">
                  ${esc(val.label)}
              </span>
              <span class="rule-pill-remove" onclick="OL.removeNamingRule('${nc.id}', '${cat.id}')">×</span>
          </div>
      `;
  }

  // Removes a pattern from the card
  OL.removeNamingRule = function(ncId, categoryId) {
      const nc = state.namingConventions.find(n => n.id === ncId);
      if (nc) {
          nc.rules = (nc.rules || []).filter(r => r.categoryId !== categoryId);
          OL.persist();
          renderNamingConventions();
      }
  };

  // Opens the dropdown to change a specific value
  OL.changeNamingRuleValue = function(ncId, categoryId) {
      const list = window.OL.state.namingConventions;
      const nc = list.find(n => n.id === ncId);
      
      // Look up the category in the global state
      const categories = window.OL.state.namingCategories;
      const cat = categories.find(c => c.id === categoryId);
      
      if (!nc || !cat) return;

      openMappingDropdown({
          anchorEl: event.currentTarget,
          options: cat.values.map(v => ({ id: v.id, label: v.label })),
          allowMultiple: false,

          // --- CUSTOM PATTERN LOGIC ---
          injectOnEmpty: {
              text: "+ Create Custom Pattern: '{query}'",
              onClick: (customText) => {
                  // 1. Create a new value object with a random but persistent ID
                  const newPatternId = OL.utils.uid();
                  const newPattern = { 
                      id: newPatternId, 
                      label: customText.trim() 
                  };
                  
                  // 2. Push it into the global category list in state
                  // This ensures it persists in LocalStorage via OL.persist()
                  cat.values.push(newPattern);
                  
                  // 3. Update the specific rule on the card to point to this new ID
                  nc.rules = nc.rules || [];
                  const existing = nc.rules.find(r => r.categoryId === categoryId);
                  if (existing) {
                      existing.valueId = newPatternId;
                  } else {
                      nc.rules.push({ categoryId: categoryId, valueId: newPatternId });
                  }

                  // 4. Save to LocalStorage and Refresh UI
                  OL.persist();
                  renderNamingConventions();
              }
          },
          // ----------------------------

          onSelect: (valId) => {
              nc.rules = nc.rules || [];
              const existing = nc.rules.find(r => r.categoryId === categoryId);
              if (existing) existing.valueId = valId;
              else nc.rules.push({ categoryId: categoryId, valueId: valId });

              OL.persist();
              renderNamingConventions(); 
          }
      });
  };
  
  function renderNamingGrid() {
      const grid = document.getElementById("namingGrid");
      if (!grid) return;

      grid.innerHTML = (state.namingConventions || []).map(nc => {
          const activeRules = (nc.rules || []).filter(r => r.valueId);
          return `
              <div class="card segment-persona-card">
                  <div class="card-header">
                      <div class="card-title" contenteditable="true" onblur="OL.renameNamingScenario('${nc.id}', this.textContent)">
                          ${esc(nc.name)}
                      </div>
                      <div class="card-close" onclick="OL.deleteNamingScenario('${nc.id}')">×</div>
                  </div>
                  <div class="card-body">
                      <div class="pill-stack">
                          ${activeRules.map(r => renderNamingRulePill(nc, r)).join('')}
                          <button class="btn-add-pill" onclick="OL.addRuleToNaming('${nc.id}')">+ Add Pattern</button>
                      </div>
                  </div>
              </div>`;
      }).join('');
  }

  OL.addRuleToNaming = function(ncId) {
      const nc = state.namingConventions.find(n => n.id === ncId);
      const btn = event.currentTarget;

      const categoryOptions = state.namingCategories.map(cat => ({
          id: cat.id,
          label: cat.name
      }));

      openMappingDropdown({
          anchorEl: btn,
          options: categoryOptions,
          allowMultiple: false,
          onSelect: (catId) => {
              const selectedCat = state.namingCategories.find(c => c.id === catId);
              setTimeout(() => {
                  openMappingDropdown({
                      anchorEl: btn,
                      options: selectedCat.values.map(v => ({ id: v.id, label: v.label })),
                      allowMultiple: false,
                      onSelect: (valId) => {
                          nc.rules = nc.rules || [];
                          const existing = nc.rules.find(r => r.categoryId === catId);
                          if (existing) existing.valueId = valId;
                          else nc.rules.push({ categoryId: catId, valueId: valId });

                          OL.persist();
                          renderNamingGrid();
                      }
                  });
              }, 50);
          }
      });
  };

  // 🛠️ Helper: Correct Sidebar Rendering
  function renderNamingSidebar() {
      const list = document.getElementById("namingSidebarList");
      if (!list) return;
      const types = ["Household", "Lifecycle", "Custom Scenarios"];
      list.innerHTML = types.map(type => `
          <div class="sidebar-item" onclick="document.getElementById('anchor-${type.replace(/\s+/g, '')}').scrollIntoView({behavior: 'smooth'})">
              <div class="sidebar-item-title">${type}</div>
          </div>
      `).join('');
  }

  function bindNamingConventions() {
      const grid = document.getElementById("namingGrid");
      if (!grid) return;

      // 1. Handle the Header Buttons
      const btnAddScenario = document.getElementById("btnNamingAddScenario");
      if (btnAddScenario) {
          btnAddScenario.onclick = () => {
              if (!state.namingConventions.scenarios) state.namingConventions.scenarios = [];
              state.namingConventions.scenarios.push({
                  name: "New Scenario",
                  household: {},
                  lifecycle: {}
              });
              OL.persist();
              renderNamingConventions(); // Re-render to show the new card
          };
      }

      const btnAddDp = document.getElementById("btnNamingGlobalDP");
      if (btnAddDp) {
          btnAddDp.onclick = (e) => {
              if (!OL.activeEditable) return alert("Click into a field first.");
              
              OL.openDatapointDropdown(e.currentTarget, (dp) => {
                  // Insert the token and manually trigger 'input' to save
                  OL.insertDatapointToken(OL.activeEditable, dp.key);
                  OL.activeEditable.dispatchEvent(new Event('input', { bubbles: true }));
              });
          };
      }

      // 2. Track Focus for Token Insertion
      grid.querySelectorAll(".naming-input").forEach(input => {
          input.onfocus = () => { OL.activeEditable = input; };
      });
  }

  /**
   * Generates a real-world preview of the naming pattern.
   */
  function formatNamingPreview(pattern) {
      const sample = {
          primaryFirst: "Jane",
          primaryLast: "Doe",
          partnerFirst: "Alex",
          partnerLast: "Smith",
          sharedLast: "Doe",
          household: "Doe, Jane & Alex",
          year: new Date().getFullYear(),
      };

      // Strip HTML tags if the user pasted formatted text
      let cleanPattern = String(pattern || "").replace(/<\/?[^>]+(>|$)/g, "");

      return cleanPattern
          .replace(/{primaryFirst}/g, sample.primaryFirst)
          .replace(/{primaryLast}/g, sample.primaryLast)
          .replace(/{partnerFirst}/g, sample.partnerFirst)
          .replace(/{partnerLast}/g, sample.partnerLast)
          .replace(/{sharedLast}/g, sample.sharedLast)
          .replace(/{household}/g, sample.household)
          .replace(/{year}/g, sample.year);
  }
  /**
   * Direct-access update for naming patterns.
   */
  OL.updateNamingPattern = debounce((category, key, value, scenarioIdx) => {
      if (!state.namingConventions) {
          state.namingConventions = { household: {}, lifecycle: {}, scenarios: [] };
      }
      
      const nc = state.namingConventions;

      if (scenarioIdx !== null) {
          // Handle nested scenario update
          if (nc.scenarios[scenarioIdx]) {
              nc.scenarios[scenarioIdx][category] = nc.scenarios[scenarioIdx][category] || {};
              nc.scenarios[scenarioIdx][category][key] = value;
          }
      } else {
          // Handle global pattern update
          nc[category] = nc[category] || {};
          nc[category][key] = value;
      }

      // Update the local preview span immediately for live feedback
      const activeEl = OL.activeEditable;
      if (activeEl) {
          const row = activeEl.closest('.naming-row');
          const previewSpan = row.querySelector('.naming-preview-text');
          if (previewSpan) {
              previewSpan.textContent = formatNamingPreview(activeEl.textContent);
          }
      }

      OL.persist();
  }, 300);

  OL.addRuleToNaming = function(ncId) {
      // 1. Find the specific card in our namingConventions array
      const list = window.OL.state.namingConventions;
      const nc = list.find(n => n.id === ncId);
      if (!nc) return;

      const btn = event.currentTarget;

      // 2. Prepare the Categories (e.g., "Household Style", "Lifecycle Prefix")
      const categoryOptions = state.namingCategories.map(cat => ({
          id: cat.id,
          label: cat.name
      }));

      // 3. Open the first dropdown to pick the CATEGORY
      openMappingDropdown({
          anchorEl: btn,
          options: categoryOptions,
          allowMultiple: false,
          onSelect: (catId) => {
              const selectedCat = state.namingCategories.find(c => c.id === catId);
              
              // 4. Open the second dropdown to pick the specific VALUE (Pattern)
              setTimeout(() => {
                  openMappingDropdown({
                      anchorEl: btn,
                      options: selectedCat.values.map(v => ({ id: v.id, label: v.label })),
                      allowMultiple: false,
                      onSelect: (valId) => {
                          nc.rules = nc.rules || [];
                          
                          // Update existing rule for this category or add new one
                          const existing = nc.rules.find(r => r.categoryId === catId);
                          if (existing) {
                              existing.valueId = valId;
                          } else {
                              nc.rules.push({ categoryId: catId, valueId: valId });
                          }

                          // 5. Persist and Re-render
                          OL.persist();
                          renderNamingConventions(); 
                      }
                  });
              }, 50);
          }
      });
  };

  OL.deleteNamingScenario = function(ncId) {
      const list = window.OL.state.namingConventions;
      if (!Array.isArray(list)) return;

      const idx = list.findIndex(nc => nc.id === ncId);
      
      if (idx !== -1 && confirm("Delete this naming convention?")) {
          // Splice now works because 'list' is guaranteed to be an array
          list.splice(idx, 1); 
          OL.persist();
          renderNamingConventions();
      }
  };

  OL.renameNamingScenario = function(ncId, newName) {
      // Safely access the array from the global state
      const list = window.OL.state.namingConventions;
      if (!Array.isArray(list)) return;

      // Use .find() to get the specific card by its unique ID
      const nc = list.find(item => item.id === ncId);
      
      if (nc) {
          nc.name = (newName || "").trim();
          OL.persist();
          // No need to full renderNamingConventions, just update sidebar
          if (typeof renderNamingSidebar === "function") renderNamingSidebar();
      }
  };
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
  // RESOURCES GRID
  // ------------------------------------------------------------
  function resourceTypeLabel(t) {
    switch (t) {
      case "doc":
        return "Document / PDF";
      case "form":
        return "Form";
      case "scheduler":
        return "Scheduler Event";
      case "emailTemplate":
        return "Email Template";
      case "emailCampaign":
        return "Email Campaign";
      case "zap":
        return "Zap";
      default:
        return "Resource";
    }
  }

  function getTeamMemberById(id) {
    return (state.teamMembers || []).find((m) => m.id === id) || null;
  }

  function getResourceById(id) {
    return (state.resources || []).find((r) => r.id === id) || null;
  }

  function renderResourcesGrid() {
    const grid = document.getElementById("resourcesGrid");
    if (!grid) return;

    const all = Array.isArray(state.resources) ? state.resources : [];

    // highlight active filter button
    const filterWrap = document.getElementById("resourcesFilters");
    if (filterWrap) {
      filterWrap.querySelectorAll("[data-res-type]").forEach((btn) => {
        const t = btn.getAttribute("data-res-type");
        if (t === currentResourceFilter) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
    }

    let list = all;
    if (currentResourceFilter !== "all") {
      list = all.filter((r) => (r.type || "doc") === currentResourceFilter);
    }

    if (!list.length) {
      grid.innerHTML = `<div class="empty-hint">No resources yet for this view.</div>`;
      return;
    }

    // sort by name
    list = list
      .slice()
      .sort((a, b) =>
        (a.name || "")
          .toLowerCase()
          .localeCompare((b.name || "").toLowerCase()),
      );

    grid.innerHTML = "";

    list.forEach((r) => {
      const type = r.type || "doc";
      const typeLabel = resourceTypeLabel(type);

      const apps = (r.appIds || [])
        .map((id) => findAppById(id))
        .filter(Boolean);

      const owners = (r.ownerIds || [])
        .map((id) => getTeamMemberById(id))
        .filter(Boolean);

      const resourcesUsed = (r.resourcesUsed || [])
        .map((id) => getResourceById(id))
        .filter(Boolean);

      // backlinks: other resources that reference this one
      const usedInResources = all.filter(
        (other) =>
          Array.isArray(other.resourcesUsed) &&
          other.resourcesUsed.includes(r.id),
      );

      const linkLabel = r.link
        ? r.link.length > 60
          ? r.link.slice(0, 60) + "…"
          : r.link
        : "";

      const appsHtml = apps.length
        ? apps
            .map((a) => `<span class="pill integr"
            onclick="event.stopPropagation(); OL.openAppModal('${a.id}')">
            ${esc(a.name || "")}</span>`)
            .join("")
        : `<span class="pill muted">No app mapped</span>`;

      const ownersHtml = owners.length
        ? owners
            .map(
              (m) => `
            <span class="pill fn"
                  onclick="event.stopPropagation(); OL.openTeamMemberModal('${m.id}')">
              ${esc(m.name || "")}
            </span>
          `,
            )
            .join("")
        : `<span class="pill muted">No owners</span>`;

      const tagsHtml = (r.tags || []).length
        ? (r.tags || [])
            .map((t) => `<span class="pill xsmall">${esc(t)}</span>`)
            .join("")
        : `<span class="pill muted">No tags</span>`;

      const usedHtml = resourcesUsed.length
        ? resourcesUsed
            .map(
              (rr) => `
            <span class="pill xsmall"
                  onclick="event.stopPropagation(); OL.openResourceModal('${rr.id}')">
              ${esc(rr.name || "")}
            </span>
          `,
            )
            .join("")
        : `<span class="pill muted">None</span>`;

      const usedInHtml = usedInResources.length
        ? usedInResources
            .map(
              (rr) => `
            <span class="pill xsmall"
                  onclick="event.stopPropagation(); OL.openResourceModal('${rr.id}')">
              ${esc(rr.name || "")}
            </span>
          `,
            )
            .join("")
        : `<span class="pill muted">None yet</span>`;

      grid.insertAdjacentHTML(
        "beforeend",
        `
        <div class="card resource-card" data-res-id="${r.id}">
          <div class="card-header">
            <div class="card-header-left">
              <div class="card-title single-line-text">${esc(r.name || "")}</div>
              <span class="pill xsmall soft">${esc(typeLabel)}</span>
            </div>
            <div class="card-close"
                 onclick="event.stopPropagation(); OL.deleteResource('${r.id}')">×</div>
          </div>
          <div class="card-body">

            <div class="card-section">
              <div class="card-section-title">Description</div>
              <div class="card-section-content single-line-text ${r.description ? "" : "muted"}">
                ${esc(r.description || "No description")}
              </div>
            </div>

            <div class="card-section">
              <div class="card-section-title">Primary Link</div>
              <div class="card-section-content single-line-text">
                ${
                  r.link
                    ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">Open</a>`
                    : `<span class="muted">No link</span>`
                }
              </div>
            </div>

            <div class="card-section">
              <div class="card-section-title">App</div>
              <div class="card-section-content">
                <div class="pills-row">${appsHtml}</div>
              </div>
            </div>

            <div class="card-section">
              <div class="card-section-title">Owners</div>
              <div class="card-section-content">
                <div class="pills-row">${ownersHtml}</div>
              </div>
            </div>

            <div class="card-section">
              <div class="card-section-title">Tags</div>
              <div class="card-section-content">
                <div class="pills-row">${tagsHtml}</div>
              </div>
            </div>

            <div class="card-section">
              <div class="card-section-title">Resources Used</div>
              <div class="card-section-content">
                <div class="pills-row">${usedHtml}</div>
              </div>
            </div>

            <div class="card-section">
              <div class="card-section-title">Used In (Resources)</div>
              <div class="card-section-content">
                <div class="pills-row">${usedInHtml}</div>
              </div>
            </div>

          </div>
        </div>
      `,
      );
    });

    // wire card click → modal
    grid.querySelectorAll(".resource-card").forEach((card) => {
      card.onclick = (e) => {
        e.preventDefault();
        const id = card.getAttribute("data-res-id");
        if (id) OL.openResourceModal(id);
      };
    });
  }

  OL.setResourceFilter = function (type) {
    currentResourceFilter = type || "all";
    renderResourcesGrid();
  };

  OL.deleteResource = function (id) {
    const res = getResourceById(id);
    if (!res) return;
    if (!confirm(`Delete resource "${res.name || "this resource"}"?`)) return;

    // remove from list
    state.resources = (state.resources || []).filter((r) => r.id !== id);

    // strip from other resources' resourcesUsed
    (state.resources || []).forEach((r) => {
      if (Array.isArray(r.resourcesUsed)) {
        r.resourcesUsed = r.resourcesUsed.filter((rid) => rid !== id);
      }
    });

    OL.persist();
    renderResourcesGrid();
  };

  // ------------------------------------------------------------
  // RESOURCE MODAL (draft-safe)
  // ------------------------------------------------------------
  function renderResourceModalHTML(r, isNew = false) {
    const typeOptions = `
      <option value="doc"  ${r.type === "doc" ? "selected" : ""}>Document / PDF</option>
      <option value="form" ${r.type === "form" ? "selected" : ""}>Form</option>
      <option value="scheduler" ${r.type === "scheduler" ? "selected" : ""}>Scheduler Event</option>
      <option value="emailTemplate" ${r.type === "emailTemplate" ? "selected" : ""}>Email Template</option>
      <option value="emailCampaign" ${r.type === "emailCampaign" ? "selected" : ""}>Email Campaign</option>
      <option value="zap"  ${r.type === "zap" ? "selected" : ""}>Zap</option>
    `;
   
    const connections = getResourceUsageConnections(r.id);

    // Build the "Used In" pill HTML
    const downstreamHTML = [
        ...connections.downstreamRes.map(res => `
            <button class="pill resource" onclick="OL.closeModal(); setTimeout(() => OL.openResourceModal('${res.id}'), 50)">
                📄 ${esc(res.name)}
            </button>`),
        ...connections.downstreamWf.map(wf => `
            <button class="pill fn" onclick="OL.closeModal(); setTimeout(() => OL.openWorkflowVisualizer('${wf.id}'), 50)">
                ⚙️ ${esc(wf.name)}
            </button>`)
    ].join("");

    const tagsText = (r.tags || []).join(", ");

    const iframeHtml = r.link
      ? `<iframe src="${esc(r.link)}" class="resource-iframe" style="width:100%;min-height:260px;border:1px solid #ddd;border-radius:8px;"></iframe>`
      : `<div class="empty-hint">Add a link to preview this resource here.</div>`;

      return `
        <div class="modal-head">
          <div class="modal-title-text"
              id="resName"
              contenteditable="true"
              data-placeholder="New Resource">
              ${esc(r.name || "")}
          </div>
          <div class="spacer"></div>
          <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>

        <div class="modal-body">
          <div class="modal-row">
            <div class="modal-column">
              <label class="modal-section-label">Type</label>
              <select id="resType" class="modal-textarea" style="min-height:auto;height:auto;">${typeOptions}</select>
            </div>
            <div class="modal-column">
              <label class="modal-section-label">Tags</label>
              <input id="resTags" class="modal-textarea" style="min-height:auto;height:auto;" value="${esc((r.tags || []).join(', '))}">
            </div>
          </div>

          <div class="modal-row" style="gap:20px; border-bottom: 1px solid var(--line); padding-bottom: 15px; margin-bottom: 10px;">
            <div class="modal-column">
              <label class="modal-section-label">App</label>
              <div id="resAppPills" class="pills-row" style="margin-bottom:6px;"></div>
              <button class="btn xsmall soft" id="resAppPicker">+ Map App</button>
            </div>
            <div class="modal-column">
              <label class="modal-section-label">Owners</label>
              <div id="resOwnerPills" class="pills-row" style="margin-bottom:6px;"></div>
              <button class="btn xsmall soft" id="resOwnerPicker">+ Map Owner</button>
            </div>
          </div>

          <div class="modal-row" style="gap:20px; border-bottom: 1px solid var(--line); padding-bottom: 15px; margin-bottom: 10px;">
            <div class="modal-column">
              <label class="modal-section-label">Resources Used (Upstream)</label>
              <div id="resResourcePills" class="pills-row" style="margin-bottom:6px;"></div>
              <button class="btn xsmall soft" id="resResourcePicker">+ Link Dependency</button>
            </div>
            <div class="modal-column">
              <label class="modal-section-label">Used In (Downstream)</label>
              <div class="modal-pill-box">
                  ${downstreamHTML || '<div class="empty-hint">Not used in other assets.</div>'}
              </div>
            </div>
          </div>

          <label class="modal-section-label">Description</label>
          <textarea id="resDesc" class="modal-textarea" style="min-height:60px;">${esc(r.description || "")}</textarea>

          <label class="modal-section-label">Primary Link</label>
          <input id="resLink" class="modal-textarea" style="min-height:auto;height:auto;" value="${esc(r.link || "")}">

          <div id="resPreviewBlock" style="margin-top:10px;">${iframeHtml}</div>
        </div>
      `;
  }
  function getResourceUsageConnections(resId) {
      // 1. Upstream: What resources does THIS one use? (Directly stored in resourcesUsed)
      const upstream = (state.resources || []).filter(r => 
          (getResourceById(resId)?.resourcesUsed || []).includes(r.id)
      );

      // 2. Downstream: Where is THIS resource being used?
      // 2a. In other Resources
      const usedInResources = (state.resources || []).filter(r => 
          r.id !== resId && (r.resourcesUsed || []).includes(resId)
      );
      // 2b. In Workflow Templates
      const usedInWorkflows = (state.workflows || []).filter(wf => 
          (wf.nodes || []).some(node => (node.resourceIds || []).includes(resId))
      );

      return { upstream, downstreamRes: usedInResources, downstreamWf: usedInWorkflows };
  }
    // Add this function near your Resource modal logic
  function openResourceAppAssignUI(resource) {
      const layer = getModalLayer();
      const anchorEl = layer.querySelector("#resAppPicker");
      if (!anchorEl) return;

      // Filter apps: The dropdown should only show currently unassigned apps, plus the one currently assigned.
      const currentAppId = (resource.appIds && resource.appIds.length > 0) ? resource.appIds[0] : null;
      const mappedIds = new Set(resource.appIds || []);

      const options = state.apps
          .filter(Boolean)
          .map((app) => ({
              id: app.id,
              label: app.name,
              checked: app.id === currentAppId,
              // Disable other apps if one is already selected (single-select logic)
              disabled: currentAppId && app.id !== currentAppId && mappedIds.has(app.id),
          }))
          .sort((a, b) => a.label.localeCompare(b.label));

      openMappingDropdown({
          anchorEl: anchorEl,
          options: options,
          allowMultiple: false, // Enforce single selection
          onSelect: (appId) => {
              // Since this is single-select, the new array is either [appId] or []
              resource.appIds = appId ? [appId] : [];
              
              OL.persist();
              renderResourceModalPills(resource); // Re-render pills inside modal
              OL.refreshAllUI(); // Refresh main resource grid/cards
          },
      });
  }

  // Add this function near your Resource modal logic
  function openResourceOwnerAssignUI(resource) {
      const layer = getModalLayer();
      const anchorEl = layer.querySelector("#resOwnerPicker");
      if (!anchorEl) return;

      const mappedIds = new Set(resource.ownerIds || []);
      
      const options = state.teamMembers
          .filter(Boolean)
          .map((member) => ({
              id: member.id,
              label: member.name,
              checked: mappedIds.has(member.id),
          }))
          .sort((a, b) => a.label.localeCompare(b.label));

      openMappingDropdown({
          anchorEl: anchorEl,
          options: options,
          allowMultiple: true, // Allow multiple owners
          onSelect: (memberId, isChecked) => {
              if (isChecked) {
                  if (!resource.ownerIds.includes(memberId)) {
                      resource.ownerIds.push(memberId);
                  }
              } else {
                  resource.ownerIds = resource.ownerIds.filter((id) => id !== memberId);
              }
              
              OL.persist();
              renderResourceModalPills(resource); // Re-render pills inside modal
              // No need to call OL.refreshAllUI here if owners aren't shown on the grid cards
          },
      });
  }

  // Define the helper function to render all pills inside the modal
  function renderResourceModalPills(resource) {
      if (!resource) return;

      const layer = getModalLayer();
      if (!layer) return;

      // --- 1. App Pills ---
      const appPillsBox = layer.querySelector("#resAppPills");
      const apps = (resource.appIds || [])
          .map((id) => findAppById(id))
          .filter(Boolean);
      
      if (appPillsBox) {
          appPillsBox.innerHTML = apps.length
              ? apps.map((a) => `
                  <span class="pill integr"
                        onclick="event.stopPropagation(); OL.openAppModal('${a.id}')">
                      ${OL.utils.esc(a.name || "")}
                  </span>`).join("")
              : `<span class="pill muted">No app assigned</span>`;
      }

      // --- 2. Owner Pills ---
      const ownerPillsBox = layer.querySelector("#resOwnerPills");
      const owners = (resource.ownerIds || [])
          .map((id) => findTeamMemberById(id))
          .filter(Boolean);

      if (ownerPillsBox) {
          ownerPillsBox.innerHTML = owners.length
              ? owners.map((m) => `
                  <span class="pill fn"
                        onclick="event.stopPropagation(); OL.openTeamMemberModal('${m.id}')">
                      ${OL.utils.esc(m.name || "")}
                  </span>`).join("")
              : `<span class="pill muted">No owners assigned</span>`;
      }
      
      const appBox = layer.querySelector("#resAppPills");
        if (appBox) {
            const apps = (resource.appIds || []).map(id => findAppById(id)).filter(Boolean);
            appBox.innerHTML = apps.map(a => `
                <div class="pill outcome-pill">
                    <button class="nav-zone-btn" onclick="OL.closeModal(); setTimeout(() => OL.openAppModal('${a.id}'), 50)">
                        ${OL.iconHTML(a)} ${esc(a.name)}
                    </button>
                    <button class="remove-zone-btn" onclick="OL.removeAppFromResource('${resource.id}', '${a.id}')">×</button>
                </div>
            `).join("") || '<span class="pill muted">None</span>';
        }

        // 2. Resource Dependencies (Upstream)
        const resBox = layer.querySelector("#resResourcePills");
        if (resBox) {
            const deps = (resource.resourcesUsed || []).map(id => getResourceById(id)).filter(Boolean);
            resBox.innerHTML = deps.map(d => `
                <div class="pill outcome-pill">
                    <button class="nav-zone-btn" onclick="OL.closeModal(); setTimeout(() => OL.openResourceModal('${d.id}'), 50)">
                        📄 ${esc(d.name)}
                    </button>
                    <button class="remove-zone-btn" onclick="OL.removeDependencyFromResource('${resource.id}', '${d.id}')">×</button>
                </div>
            `).join("") || '<span class="pill muted">None</span>';
        }
  }

  // Ensure the helper used in the binder (renderResourcePills) calls the main function
  // Note: You must remove the previous if (typeof renderResourcePills === "function") check 
  // and directly call the rendering function defined above inside bindResourceModal.

  OL.openResourceModal = function (resourceOrId, isNew = false) {
    // support passing object OR id
    const res =
      typeof resourceOrId === "object"
        ? resourceOrId
        : getResourceById(resourceOrId);

    if (!res) {
      console.error("openResourceModal: resource not found", resourceOrId);
      return;
    }

    activeOnClose = null;

    // IMPORTANT: call your modal HTML renderer here
    openModal(renderResourceModalHTML(res, isNew));

    // bind AFTER the modal exists
    setTimeout(() => bindResourceModal(res, isNew), 0);
  };

  function bindResourceModal(resource, isNew) {
    const layer = getModalLayer();
    if (!layer) return;

    // if resource has _draft, it hasn’t been committed yet
    let created = !resource._draft;

    // On close: if still draft, discard (just don't push it later)
    activeOnClose = () => {
      if (!resource._draft) return;
      state.resources = state.resources.filter((r) => r !== resource);
      renderResourcesGrid();
    };

    function commitIfNeeded(val) {
      if (created || !val) return;
      created = true;
      delete resource._draft;
      OL.persist();
      renderResourcesGrid();
    }

    // ⬇️ PLACEHOLDER LOGIC START ⬇️
    function updatePlaceholder(el) {
      el.dataset.empty = el.textContent.trim() === "" ? "true" : "false";
    }
    // ⬆️ PLACEHOLDER LOGIC END ⬆️

    const nameEl = layer.querySelector("#resName");
    const notesEl = layer.querySelector("#resourceNotes");

    // when opening brand new, blank name field
    if (isNew && nameEl) {
      nameEl.textContent = "";
    }

    // NAME field
    if (nameEl) {
      // ⬇️ PLACEHOLDER ACTIVATION ⬇️
      nameEl.addEventListener("input", () => updatePlaceholder(nameEl));
      requestAnimationFrame(() => updatePlaceholder(nameEl));
      // ⬆️ PLACEHOLDER ACTIVATION ⬆️

      nameEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          nameEl.blur();
        }
      });

      nameEl.addEventListener("blur", () => {
        const newName = nameEl.textContent.trim();
        if (!newName || newName === "New Resource") return;

        commitIfNeeded(newName);
        resource.name = newName;
        OL.persist();
        renderResourcesGrid();
      });

      // clean stray <br>
      nameEl.addEventListener("input", () => {
        if (nameEl.innerHTML === "<br>" || nameEl.textContent.trim() === "") {
          nameEl.innerHTML = "";
        }
      });
    }

    // NOTES field
    if (notesEl) {
      notesEl.addEventListener(
        "input",
        debounce(() => {
          if (!resource._draft) {
            resource.notes = notesEl.value;
            OL.persist();
            renderResourcesGrid();
          }
        }, 200),
      );
    }

    // 1. Link Dependency Picker (Upstream Resources)
    const resPickerBtn = layer.querySelector("#resResourcePicker");
    if (resPickerBtn) {
        resPickerBtn.onclick = (e) => {
            e.stopPropagation();
            const currentIds = resource.resourcesUsed || [];
            
            // Filter out the current resource so it can't depend on itself
            const options = (state.resources || [])
                .filter(r => r.id !== resource.id)
                .map(r => ({
                    id: r.id,
                    label: r.name,
                    checked: currentIds.includes(r.id)
                }))
                .sort((a, b) => a.label.localeCompare(b.label));

            openMappingDropdown({
                anchorEl: resPickerBtn,
                options: options,
                allowMultiple: true,
                onSelect: (selectedId, isChecked) => {
                    resource.resourcesUsed = resource.resourcesUsed || [];
                    if (isChecked) {
                        if (!resource.resourcesUsed.includes(selectedId)) resource.resourcesUsed.push(selectedId);
                    } else {
                        resource.resourcesUsed = resource.resourcesUsed.filter(id => id !== selectedId);
                    }
                    OL.persist();
                    renderResourceModalPills(resource); // Refresh the pills in the modal
                    
                    // Keep the dropdown open/refreshed
                    const dd = document.querySelector(".mapping-dropdown");
                    if (dd && dd.refresh) dd.refresh();
                }
            });
        };
    }

    // 2. Map App Picker
    const appPickerBtn = layer.querySelector("#resAppPicker");
    if (appPickerBtn) {
        appPickerBtn.onclick = (e) => {
            e.stopPropagation();
            openResourceAppAssignUI(resource); // Uses your existing logic
        };
    }

    // 3. Map Owner Picker
    const ownerPickerBtn = layer.querySelector("#resOwnerPicker");
    if (ownerPickerBtn) {
        ownerPickerBtn.onclick = (e) => {
            e.stopPropagation();
            openResourceOwnerAssignUI(resource); // Uses your existing logic
        };
    }

    if (appPickerBtn) {
        appPickerBtn.onclick = (e) => {
            e.stopPropagation();
            openResourceAppAssignUI(resource);
        };
    }

    if (ownerPickerBtn) {
        ownerPickerBtn.onclick = (e) => {
            e.stopPropagation();
            openResourceOwnerAssignUI(resource);
        };
    }

    renderResourceModalPills(resource);
  }

  // Remove an App from a Resource
  OL.removeAppFromResource = function(resourceId, appId) {
      const res = getResourceById(resourceId);
      if (!res) return;
      res.appIds = (res.appIds || []).filter(id => id !== appId);
      OL.persist();
      renderResourceModalPills(res);
  };

  // Remove a Dependency (Upstream Resource) from a Resource
  OL.removeDependencyFromResource = function(resourceId, depId) {
      const res = getResourceById(resourceId);
      if (!res) return;
      res.resourcesUsed = (res.resourcesUsed || []).filter(id => id !== depId);
      OL.persist();
      renderResourceModalPills(res);
  };
  // ------------------------------------------------------------
  // TOP BUTTONS
  // ------------------------------------------------------------
  function wireTopButtons() {
    const btnAddApp = document.getElementById("btnAddApp");
    const btnAddFn = document.getElementById("btnAddFunction");
    const btnAddFeature = document.getElementById("btnAddFeature");
    const btnAddInt = document.getElementById("btnAddIntegration");
    const btnAddDpGlobal = document.getElementById("btnAddDatapointGlobal");
    const btnNewGroup = document.getElementById("btnNewDatapointGroup");
    const btnAddCapability = document.getElementById("btnAddCapability");
    const btnAddCanonicalCap = document.getElementById("btnAddCanonicalCap");
    const btnAddTeamMember = document.getElementById("btnAddTeamMember");
    const btnAddTeamRole = document.getElementById("btnAddTeamRole");
    const btnUnifiedCat = document.getElementById("btnUnifiedAddCategory");
    const btnUnifiedPersona = document.getElementById("btnUnifiedAddPersona");
    const btnAddFolderHierarchy = document.getElementById("btnAddFolderHierarchy");
    const btnAddNamingConvention = document.getElementById("btnAddNamingConvention");
    const btnAddResource = document.getElementById("btnAddResource");
    const btnAddWorkflow = document.getElementById("btnAddWorkflow");

    if (btnAddApp) {
      btnAddApp.onclick = () => {
        const draftApp = {
          id: uid(),
          name: "",
          icon: null,
          notes: "",
          functions: [],
          integrations: [],
          datapointMappings: [],
          _draft: true,
        };
        state.apps.push(draftApp);
        OL.openAppModal(draftApp.id, true);
      };
    }

    if (btnAddFn) {
      btnAddFn.onclick = () => {
        const draftFn = {
          id: uid(),
          name: "",
          notes: "",
          icon: null,
          _draft: true,
        };
        state.functions.push(draftFn);
        OL.openFunctionModal(draftFn.id, true);
      };
    }

    if (btnAddInt) {
      btnAddInt.onclick = () => {
        alert(
          'To add an integration, open an App card and use "+ Add Integration" in the modal.',
        );
      };
    }

    if (btnNewGroup) {
        btnNewGroup.onclick = () => {
            const newTypeName = prompt("Enter new Object Type (e.g., 'Insurance', 'Tax'):");
            if (!newTypeName) return;
            
            // Create a dummy datapoint just to initialize the group
            const placeholderDp = {
                id: OL.utils.uid(),
                name: `First ${newTypeName} Datapoint`,
                description: "",
                objectType: newTypeName.trim(),
                _draft: true
            };
            state.datapoints.push(placeholderDp);
            OL.persist();
            renderDatapointsGrid(); // Refresh to show new sidebar item and group
        };
    }

    if (btnAddDpGlobal) {
      btnAddDpGlobal.onclick = () => {
        const draftDp = {
          id: uid(),
          name: "",
          description: "",
          type: "",
          usedByApps: [],
          usedByFunctions: [],
          _draft: true,
        };

        OL.openDatapointModal(draftDp, true);
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
        const cap = {
          id: uid(),
          _draft: true,
          canonical: "New Canonical Capability",
          description: "",
        };
        OL.openCanonicalCapModal(cap, true);
      };
    }

    if (btnAddTeamMember) {
      btnAddTeamMember.onclick = () => {
        const tm = {
          id: uid(),
          name: "",
          title: "",
          email: "",
          notes: "",
          roles: [],
          icon: null,
          _draft: true,
        };

        OL.openTeamMemberModal(tm, true);
      };
    }

    if (btnAddTeamRole) {
      btnAddTeamRole.onclick = () => {
        const role = {
          id: uid(),
          name: "",
          description: "",
          notes: "",
          _draft: true,
        };
        OL.openTeamRoleModal(role, true);
      };
    }

    if (btnUnifiedCat) {
        btnUnifiedCat.onclick = () => {
            const cat = { id: uid(), name: "New Category", values: [], _draft: true };
            state.segmentCategories.push(cat);
            OL.persist();
            renderUnifiedSegmentBuilder();
            setTimeout(() => OL.openSegmentCategoriesModal(cat.id), 50);
        };
    }

    if (btnUnifiedPersona) {
        btnUnifiedPersona.onclick = () => {
            const seg = { id: uid(), name: "New Persona", rules: [], description: "" };
            state.segments.push(seg);
            OL.persist();
            renderUnifiedSegmentBuilder();
        };
    }

    if (btnAddNamingConvention) {
        btnAddNamingConvention.onclick = () => {
            if (!Array.isArray(window.OL.state.namingConventions)) {
                window.OL.state.namingConventions = [];
            }

            window.OL.state.namingConventions.push({
                id: OL.utils.uid(),
                name: "New Naming Scenario",
                // Pre-linking the categories to avoid "UNKNOWN" labels
                rules: [
                    { categoryId: "cat_nc_individual", valueId: null },
                    { categoryId: "cat_nc_joint_same", valueId: null },
                    { categoryId: "cat_nc_joint_diff", valueId: null }
                ]
            });

            OL.persist(); 
            renderNamingConventions();
        };
    }

    if (btnAddFolderHierarchy) {
        btnAddFolderHierarchy.onclick = () => {
            // 1. Create the new hierarchy object
            const newHier = {
                id: OL.utils.uid(),
                name: "New Folder Hierarchy",
                description: "",
                nodes: [] // Initialize with empty folder tree
            };

            // 2. Add to global state
            if (!Array.isArray(window.OL.state.folderHierarchy)) {
                window.OL.state.folderHierarchy = [];
            }
            window.OL.state.folderHierarchy.push(newHier);

            // 3. Save and open the editor immediately
            OL.persist(); 
            renderFolderHierarchyGrid();
            OL.openFolderHierarchyModal(newHier.id);
        };
    }

    if (btnAddResource) {
      btnAddResource.onclick = () => {
        const r = {
          id: uid(),
          _draft: true,
          name: "",
          type: currentResourceFilter !== "all" ? currentResourceFilter : "doc",
          description: "",
          link: "",
          appIds: [],
          ownerIds: [],
          tags: [],
          resourcesUsed: [],
        };

        // insert into state so card shows immediately
        state.resources = state.resources || [];
        state.resources.push(r);

        renderResourcesGrid();

        // OPEN MODAL — MUST PASS (resource, true)
        OL.openResourceModal(r, true);
      };
    }
    if (btnAddWorkflow) {
        btnAddWorkflow.onclick = () => {
            const draftWorkflow = {
                id: uid(),
                _draft: true, // Mark as draft until named/saved
                name: "",
                description: "",
                stages: [],
                nodes: [],
            };
            
            // Note: We don't push to state.workflows yet; we open the modal with the draft object.
            OL.openWorkflowModal(draftWorkflow, true);
        };
    }

    if (btnAddFeature) {
        btnAddFeature.onclick = () => {
            const draftFeature = { id: uid(), _draft: true, name: "", notes: "", category: null, functionId: null };
            OL.openFeatureModal(draftFeature, true);
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
  OL.openAppModal = function (appOrObj, isNew = false, fnIdToAssign = null) {
      let appObj;

      if (typeof appOrObj === "string") {
          // Scenario 1: Existing app (passed by ID string)
          appObj = findAppById(appOrObj);
      } else {
          // Scenario 2: New draft app (passed by object)
          appObj = appOrObj;
      }

      if (!appObj) return; // Safety check if lookup failed

      const appId = appObj.id; 
      
      activeOnClose = null;

      // NOTE: renderAppModalHTML currently takes an ID, so we pass the ID
      openModal(renderAppModalHTML(appObj)); 
      
      // CRITICAL: Pass the app object, isNew flag, AND the fnIdToAssign to the binder.
      // The binder (bindAppModal) needs the object for drafts and the fnIdToAssign for linking.
      setTimeout(() => bindAppModal(appObj, isNew, fnIdToAssign), 0);
  };
  function renderAppModalHTML(appObj) {
    const app = appObj;
    if (!app) return '';
    const usedResources = getResourcesForApp(app.id);
    const usage = getDeepAppUsage(app.id);

    const resourcesHTML = usage.resources.map(r => `
        <button class="pill resource" onclick="OL.closeModal(); setTimeout(() => OL.openResourceModal('${r.id}'), 50)">
            📄 ${esc(r.name)}
        </button>`).join("");

    const workflowsHTML = usage.workflows.map(w => `
        <button class="pill fn" onclick="OL.closeModal(); setTimeout(() => OL.openWorkflowVisualizer('${w.id}'), 50)">
            ⚙️ ${esc(w.name)}
        </button>`).join("");

    const accessRowsHTML = (app.access || []).map(acc => renderAccessRow(app.id, acc)).join('');

    return `
      <div class="modal-head">
        <button class="icon-edit-btn" id="appIconBtn">${OL.iconHTML(app)}</button>
        <div id="appName"
          class="modal-title-text"
          contenteditable="true"
          data-placeholder="New Application">
          ${esc(app.name || "")}
        </div>
        <div class="spacer"></div>
        <button class="btn small soft" onclick="OL.closeModal()">Close</button>
      </div>
      <div class="modal-body">
        <div>
          <label class="modal-section-label">Notes</label>
          <textarea id="appNotesDisplay" class="modal-textarea">${esc(
            app.notes || "",
          )}</textarea>
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
          <div style="display:flex; justify-content:space-between; align-items:center;">
             <label class="modal-section-label">User Access & Credentials</label>
             <button class="btn xsmall soft" id="appAddAccessBtn">+ Add Member</button>
          </div>
          <div id="appAccessContainer" style="margin-top:8px;">
            <div class="access-table-header">
                    <div style="width: 120px;">Application</div>
                    <div style="width: 100px;">Level</div>
                    <div style="flex: 1;">Notes / API Credentials</div>
            </div>

            ${accessRowsHTML || '<div class="empty-hint">No team members assigned yet.</div>'}
          </div>
        </div>

        <div>
          <label class="modal-section-label">Used in Resources</label>
          <div class="modal-pill-box" style="margin-top:8px;">
            ${(resourcesHTML || workflowsHTML) ? (resourcesHTML + workflowsHTML) : '<div class="empty-hint">Not mapped to any workflows or resources.</div>'}
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

  function renderAppAccessSection(app) {
      const accessList = app.access || [];
      
      return `
          <div class="modal-section" style="margin-top: 20px; border-top: 1px solid var(--line); padding-top: 15px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                  <label class="modal-section-label">User Access & Credentials</label>
                  <button class="btn xsmall soft" onclick="OL.openMemberAccessDropdown(event, '${app.id}')">+ Add Member</button>
              </div>
              
              <div id="app-access-list-${app.id}" class="access-list">
                <div class="access-table-header">
                    <div style="width: 120px;">Application</div>
                    <div style="width: 100px;">Level</div>
                    <div style="flex: 1;">Notes / API Credentials</div>
                </div>
                <div class="access-table-body">
                  ${accessList.map(acc => renderAccessRow(app.id, acc)).join('')}
                  ${accessList.length === 0 ? '<div class="muted" style="font-size:12px;">No team members assigned yet.</div>' : ''}
                </div>
              </div>
          </div>
      `;
  }

  // 1. Open Dropdown to pick from Team Members
  OL.openMemberAccessDropdown = function(e, appId) {
      const options = (state.teamMembers || []).map(m => ({
          id: m.id,
          label: `${m.name} (${m.role || 'Member'})`
      }));

      openMappingDropdown({
          anchorEl: e.currentTarget,
          options: options,
          onSelect: (memberId) => {
              const app = state.apps.find(a => a.id === appId);
              if (!app) return;
              
              app.access = app.access || [];
              if (app.access.some(a => a.memberId === memberId)) return; // Prevent duplicates

              app.access.push({ memberId, level: "User", notes: "" });
              OL.persist();
              // Refresh modal UI
              OL.openAppModal(appId); 
              renderAppsGrid();
          }
      });
  };

  // 2. Inline Edit Access Level/Notes
  OL.updateAccessDetail = function(appId, memberId, field, value) {
      const app = state.apps.find(a => a.id === appId);
      const entry = app?.access?.find(a => a.memberId === memberId);
      if (entry) {
          entry[field] = value;
          OL.persist();
      }
  };

  function renderAccessRow(appId, accessEntry) {
      const member = state.teamMembers.find(m => m.id === accessEntry.memberId);
      if (!member) return '';

      return `
          <div class="access-row">
              <div class="datapoint-pill"
                onclick="OL.closeModal(); setTimeout(() => OL.openTeamMemberModal('${member.id}'), 50)">
                ${OL.utils.esc(member.name)}
              </div>
              
              <input type="text" 
                    class="access-input" 
                    placeholder="Level (e.g. Admin)" 
                    value="${OL.utils.esc(accessEntry.level || '')}"
                    onblur="OL.updateAccessDetail('${appId}', '${member.id}', 'level', this.value)"
                    style="width:100px; font-size:11px;">

              <input type="text" 
                    class="access-input" 
                    placeholder="Notes / API Key" 
                    value="${OL.utils.esc(accessEntry.notes || '')}"
                    onblur="OL.updateAccessDetail('${appId}', '${member.id}', 'notes', this.value)"
                    style="flex:1; font-size:11px;">

              <span class="muted clickable" onclick="OL.removeAccess('${appId}', '${member.id}')" style="padding:0 5px;">×</span>
          </div>
      `;
  }

  function getDeepAppUsage(appId) {
    // 1. Resources directly tied to this app
    const resources = (state.resources || []).filter(r => (r.appIds || []).includes(appId));
    
    // 2. Workflows using this app (Directly OR via a linked resource)
    const workflows = (state.workflows || []).filter(wf => {
        return (wf.nodes || []).some(node => {
            // Direct mapping on the step
            const isDirect = (node.appIds || []).includes(appId);
            
            // Indirect mapping via a resource attached to the step
            const isIndirect = (node.resourceIds || []).some(rId => {
                const res = getResourceById(rId);
                return res && (res.appIds || []).includes(appId);
            });
            
            return isDirect || isIndirect;
        });
    });

    return { resources, workflows };
}

  function renderAppModalFunctionPills(app) {
    if (!app) return;

    const layer = getModalLayer();
    if (!layer) return;
    const box = layer.querySelector("#appFnPills");
    if (!box) return;

    const rawAssignments = app.functions || [];

    const fnAssignments = sortByStatusStable(
      rawAssignments,
      (ref) => ref.status,
      (ref) => rawAssignments.indexOf(ref), // preserve insertion order within each status
    );

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
          onclick="OL._handleAppFnPill(event, '${app.id}', '${fn.id}')"
          oncontextmenu="OL.removeFunctionFromApp(event, '${app.id}', '${fn.id}')"
          >
            ${esc(fn.name)}
          </span>
        `;
      })
      .join("");
    }

  // =========================================================================
  // *** CORRECTED DATAPOINT DROPDOWN FILTER LOGIC (Around Line 1250) ***
  // =========================================================================
  function showDatapointDropdown(select, dpMapping, app) {
      // 1. Get the ID of the current mapping row being edited.
      const currentMappingId = dpMapping.id;

      // 2. Identify all Datapoint IDs currently used in other mappings in this app.
      const mappedIds = new Set(
          (app.datapointMappings || [])
              // Filter OUT the current mapping row so its DatapointId is not considered 'taken' by itself.
              .filter((m) => m.id !== currentMappingId)
              .map((m) => m.datapointId)
              .filter(Boolean),
      );

      // Identify the ID of the Datapoint currently mapped in the row we are editing.
      const currentDpId = dpMapping.datapointId;

      // 3. Prepare options list from all global Datapoints.
      const options = (state.datapoints || [])
          .map((dp) => {
              // Is this Datapoint the one currently selected in the row we are editing?
              const isCurrentSelection = dp.id === currentDpId;

              // If the Datapoint ID is NOT the current selection AND it's found in the mappedIds set,
              // it means another row is using it, so we mark it as disabled/unavailable.
              const isUnavailable = !isCurrentSelection && mappedIds.has(dp.id);

              return {
                  id: dp.id,
                  label: dp.name,
                  checked: isCurrentSelection, // Only the currently selected item is checked
                  disabled: isUnavailable, // Mark as disabled for filtering
              };
          })
          // FINAL FILTER: Only include options that are NOT disabled. 
          // This removes all items used elsewhere. The current selection remains.
          .filter((o) => !o.disabled)
          .sort((a, b) => a.label.localeCompare(b.label));

      const addNewDatapoint = (name) => {
        const newDp = {
            id: uid(),
            name: name || "New Datapoint",
            description: "",
            objectType: "General",
            _sortIndex: state.datapoints.length
        };
        
        state.datapoints.push(newDp);
        OL.persist();
        
        // Auto-map the newly created DP to this row
        dpMapping.datapointId = newDp.id;
        select.value = newDp.name;
        
        // Refresh UI
        const dpWrap = document.querySelector("#appDatapoints");
        renderDatapoints(dpWrap, app);
        renderDatapointsGrid(); 
    };
      
    openMappingDropdown({
          anchorEl: select,
          options: options,
          allowMultiple: false,
          injectOnEmpty: {
              text: "+ Create New Datapoint: {query}",
              onClick: (name) => {
                  // Trigger a second dropdown to pick the Object Type
                  const typeOptions = [
                      { id: 'Contact', label: '👤 Contact' },
                      { id: 'Household', label: '🏠 Household' },
                      { id: 'Account', label: '💰 Account' },
                      { id: 'General', label: '📦 General' }
                  ];

                  setTimeout(() => {
                      openMappingDropdown({
                          anchorEl: select,
                          options: typeOptions,
                          allowMultiple: false,
                          onSelect: (objectType) => {
                              // NOW create the datapoint with the selected category
                              const newDp = {
                                  id: uid(),
                                  name: name,
                                  description: "",
                                  objectType: objectType,
                                  _sortIndex: (state.datapoints || []).length
                              };
                              
                              state.datapoints.push(newDp);
                              OL.persist();
                              
                              // Map it to the current field
                              dpMapping.datapointId = newDp.id;
                              select.value = newDp.name;
                              
                              // Refresh the views
                              const dpWrap = document.querySelector("#appDatapoints");
                              if (dpWrap) renderDatapoints(dpWrap, app);
                              renderDatapointsGrid(); 
                          }
                      });
                  }, 50); // Tiny delay to ensure the first dropdown clears
              }
          },
          onSelect: (datapointId) => {
              dpMapping.datapointId = datapointId;
              select.value = getDatapointName(datapointId);
              OL.persist();
              renderDatapoints(document.querySelector("#appDatapoints"), app);
          },
      });
  }
  function renderDatapoints(container, app) {
    if (!container) return;
    container.innerHTML = "";

    (app.datapointMappings || []).forEach((dp) => {
      const row = document.createElement("div");
      row.className = "datapoint-row";

      // Datapoint selector - kept as an interactive input
      const select = document.createElement("input");
      select.type = "text";
      select.className = "dp-select";
      select.placeholder = "Select datapoint…";
      // This line MUST reflect the current selection
      select.value = getDatapointName(dp.datapointId);

      // *** CORRECTED: Re-enabling the click handler for the dropdown ***
      select.onclick = (e) => {
        e.stopPropagation();
        showDatapointDropdown(select, dp, app);
      };

      // We do NOT want it disabled if it is meant to be clicked
      select.disabled = false;

      row.appendChild(select);

      // Inbound/Outbound fields
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

      // Delete button
      const del = document.createElement("div");
      del.className = "card-close";
      del.textContent = "×";
      del.onclick = (e) => {
        e.stopPropagation();
        if (!confirm("Delete this datapoint mapping from this app?")) return;
        app.datapointMappings = app.datapointMappings.filter((x) => x !== dp);
        OL.persist();
        renderDatapoints(container, app);
        delayedSortRenders();
      };
      row.appendChild(del);

      container.appendChild(row);
    });

    if (!(app.datapointMappings || []).length) {
      container.innerHTML = `<div class="empty-hint">No datapoints yet. Click '+ Add Datapoint' below to start.</div>`;
    }
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
    const btn = layer.querySelector("#appIntAddBtn");
    if (!btn) return;

    const opts = state.apps
      //.filter(a => a.id !== app.id) // filter current app out directly
      .map((a) => {
        const isChecked = state.integrations.some(
          (i) =>
            (i.appA === app.id && i.appB === a.id) ||
            (i.appA === a.id && i.appB === app.id),
        );
        return {
          id: a.id,
          label: a.name,
          checked: isChecked,
        };
      });

    openMappingDropdown({
      anchorEl: btn,
      options: opts,
      allowMultiple: true,
      onSelect: (otherId, isChecked) => {
        const o = opts.find((x) => x.id === otherId);
        if (o) o.checked = isChecked;

        if (isChecked) {
          // add integration
          state.integrations.push({
            id: uid(),
            appA: app.id,
            appB: otherId,
            type: "zapier",
            direction: "AtoB",
            capabilities: [],
          });
        } else {
          // remove integration
          state.integrations = state.integrations.filter(
            (i) =>
              !(
                (i.appA === app.id && i.appB === otherId) ||
                (i.appA === otherId && i.appB === app.id)
              ),
          );
        }

        // persistence + refresh
        OL.persist();
        renderAppModalIntegrations(layer.querySelector("#appIntPills"), app);
        renderIntegrationsGrid();

        // live update list
        const dd = document.querySelector(".mapping-dropdown");
        if (dd && dd.refresh) dd.refresh();
      },
    });
  }

  function bindAppModal(appOrId, isNew, fnIdToAssign = null) {
        let app; // Switch to 'let' to allow re-assignment if necessary

      if (typeof appOrId === 'string') {
          // Find existing app by ID
          app = findAppById(appOrId);
      } else {
          // Use the draft object passed directly
          app = appOrId;
      }

      if (!app) return; // Safety check

      // Set 'isNew' flag based on the draft status of the retrieved object
      // This correctly handles the new App being opened from the Function Modal.
      isNew = app._draft || isNew;
      let created = !app._draft;

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
    const addAccessBtn = layer.querySelector("#appAddAccessBtn");

    activeOnClose = () => {
      if (app._draft) return;
    };

    function commitIfNeeded(val) {
      if (created || !val) return;
      created = true;
      delete app._draft;

      state.apps.push(app);

      if (fnIdToAssign) {
            const fn = findFunctionById(fnIdToAssign);
            if (fn) {
                app.functions = app.functions || [];
                
                // Check if the assignment already exists (for safety)
                if (!app.functions.some(r => r.fnId === fnIdToAssign)) {
                    // Determine status for the new link
                    const isFirst = OL.functionAssignments(fnIdToAssign).length === 0;
                    const status = isFirst ? "primary" : "available";
                    app.functions.push({ fnId: fnIdToAssign, status: status });
                }
            }
        }

      OL.persist();
    }

    // --- START: PLACEHOLDER LOGIC ADDITION ---
    function updatePlaceholder(el) {
      el.dataset.empty = el.textContent.trim() === "" ? "true" : "false";
    }

    if (nameEl) {
      // Run update on input
      nameEl.addEventListener("input", () => updatePlaceholder(nameEl));

      // Run update after the initial render and content clearing
      requestAnimationFrame(() => updatePlaceholder(nameEl));

      // Existing blur/keydown listeners below...
      nameEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          nameEl.blur();
        }
      });
      nameEl.addEventListener("blur", () => {
        const val = nameEl.textContent.trim();
        if (!val || val === "New App") return;

        commitIfNeeded(val);
        app.name = val;
        OL.persist();
        delayedSortRenders();
      });

      nameEl.addEventListener("input", () => {
        if (nameEl.innerHTML === "<br>" || nameEl.textContent.trim() === "") {
          nameEl.innerHTML = "";
        }
      });
    }
    // --- END: PLACEHOLDER LOGIC ADDITION ---

    if (iconBtn) {
      iconBtn.onclick = (e) => {
        e.stopPropagation();
        openIconPicker(app, () => {
          delayedSortRenders();

          const currentFnId = app._draft ? fnIdToAssign : null;
          const appToPass = app._draft ? app : app.id;

          OL.openAppModal(appToPass, app._draft, currentFnId);
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
      // *** CORRECTED: Re-enabling the modal button functionality ***
      addDpBtn.style.display = "block";
      addDpBtn.onclick = () => {
        // Create a temporary mapping entry. The user MUST then click
        // the input in the new row to map it to a global Datapoint.
        app.datapointMappings.push({
          id: uid(), // Must have a unique ID to filter correctly against self
          datapointId: null,
          inbound: "",
          outbound: "",
        });
        OL.persist();
        renderDatapoints(dpWrap, app);
        delayedSortRenders(); // Refresh app card count
      };
    }

    renderAppModalIntegrations(intWrap, app);

    if (intAddBtn) {
      intAddBtn.onclick = (e) => {
        e.stopPropagation();
        openModalIntegrationSelectUI(app);
      };
    }

    if (addAccessBtn) {
        addAccessBtn.onclick = (e) => OL.openMemberAccessDropdown(e, app.id);
    }
  }

  function openAppFunctionAssignUI(app) {
      const currentAppId = app.id;
      const layer = getModalLayer();
      const fnAssignBtn = layer.querySelector("#appFnAssignBtn");
      if (!fnAssignBtn) return;

    // CRITICAL FIX: Filter out null/undefined objects from state.apps before mapping.
  // 1. Prepare base options (all existing functions)
        const allFnOptions = state.functions
            .filter(Boolean)
            .map((fn) => {
              const isChecked = (app.functions || []).some((r) => r.fnId === fn.id);

              return {
                id: fn.id,
                label: fn.name,
                checked: isChecked,
              };
          });
    
      // 2. Define the callback for adding a NEW function
      const addNewFunction = (name) => {
          const draftFn = {
              id: uid(),
              name: name || "", // Use search text as name if provided
              notes: "",
              icon: null,
              _draft: true,
          };
          
          OL.openFunctionModal(draftFn, true, app.id);
      };

      openMappingDropdown({
          anchorEl: fnAssignBtn,
          options: allFnOptions,
          allowMultiple: true,
          
          // === CUSTOM INJECTION LOGIC ===
          injectOnEmpty: {
              text: "+ Create New Function: {query}",
              onClick: addNewFunction 
          },
          // ==============================
          
          onSelect: (fnId, isChecked) => {
              const appToUpdate = findAppById(currentAppId); 
              if (!appToUpdate) return;
            // Rename the local variable for clarity
              const app = appToUpdate;
              if (isChecked) {
                  app.functions = app.functions || [];

                  if (!app.functions.find((r) => r.fnId === fnId)) {
                      const isFirst = OL.functionAssignments(fnId).length === 0;
                      const status = isFirst ? "primary" : "available";
                      app.functions.push({ fnId, status });
                  }
              } else {
                  app.functions = (app.functions || []).filter((r) => r.fnId !== fnId);
              }

              OL.persist();
              renderAppModalFunctionPills(app);
              delayedSortRenders();

              // Re-fetch the dropdown element dynamically and refresh
              const dd = document.querySelector(".mapping-dropdown");
              if (dd && dd.refresh) dd.refresh();
          },
      });
  }

  // ------------------------------------------------------------
  // NEW DATAPOINT DROPDOWN FUNCTION (Not used directly by modal, keeping for completeness)
  // ------------------------------------------------------------
  OL.openAppCardDatapointDropdown = function (anchorEl, appId) {
    const app = findAppById(appId);
    if (!app) return;

    const mappedIds = new Set(
      (app.datapointMappings || []).map((m) => m.datapointId).filter(Boolean),
    );

    // Prepare options from all global datapoints that are NOT yet mapped to this app
    const options = (state.datapoints || [])
      .filter((dp) => !mappedIds.has(dp.id))
      .map((dp) => ({
        id: dp.id,
        label: dp.name,
        checked: false,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    if (options.length === 0) {
      // If there are no global datapoints at all, direct the user
      if ((state.datapoints || []).length === 0) {
        alert(
          "No global datapoints available to map. Add some in Settings > Datapoints first.",
        );
      } else {
        // All existing datapoints are already mapped
        alert(
          `All ${mappedIds.size} existing datapoints are already mapped to ${app.name}.`,
        );
      }
      return;
    }

    openMappingDropdown({
      anchorEl: anchorEl,
      options: options,
      allowMultiple: false,
      onSelect: (datapointId) => {
        // 1. Create the new mapping object
        const newMapping = {
          id: uid(),
          datapointId: datapointId,
          inbound: "", // Defaults to empty, user can fill in modal
          outbound: "", // Defaults to empty, user can fill in modal
        };

        // 2. Add it to the app's mappings
        app.datapointMappings = app.datapointMappings || [];
        app.datapointMappings.push(newMapping);

        // 3. Persist and refresh the grids/card
        OL.persist();
        OL.refreshAllUI();
      },
    });
  };

  // ------------------------------------------------------------
  // FUNCTION MODAL
  // ------------------------------------------------------------
  OL.openFunctionModal = function (fnOrObj, isNew = false, appIdToAssign = null) { // <--- ADD appIdToAssign
      let fnObj;

      if (typeof fnOrObj === "string") {
          // Scenario 1: Existing function (passed by ID string)
          fnObj = findFunctionById(fnOrObj);
      } else {
          // Scenario 2: New draft function (passed by object)
          fnObj = fnOrObj;
      }
      
      if (!fnObj) return;

      const fnId = fnObj.id; // Get the ID, whether existing or draft
      
      activeOnClose = null;
      
      // RENDER: Pass the ID to the HTML renderer (which looks up the object itself)
      openModal(renderFunctionModalHTML(fnObj));
      
      // BIND: Pass the OBJECT and the assignment ID to the binder
      setTimeout(() => bindFunctionModal(fnObj, isNew, appIdToAssign), 0); 
      // NOTE: bindFunctionModal must be updated to accept the object and the third arg.
  };

  function getFeaturesForFunction(functionId) {
    // 1. Automatic: Features where 'Group' matches this functionId
    const autoFeatures = (state.features || []).filter(f => f.functionId === functionId);
    
    // 2. Manual: Features explicitly mapped (if you have a manual mapping array)
    // For now, we rely on the functionId/Group connection
    return autoFeatures;
}

  function renderFunctionModalHTML(fnObj) {
    const fn = fnObj;
    if (!fn) return '';

    const features = getFeaturesForFunction(fn.id);
    const featuresHTML = features.length
    ? features.map(f => `
        <div class="pill outcome-pill">
            <button class="nav-zone-btn" onclick="OL.closeModal(); setTimeout(() => OL.openFeatureModal('${f.id}'), 50)">
                ✨ ${esc(f.name)}
            </button>
            <button class="remove-zone-btn" onclick="OL.removeFeatureFromFunction('${f.id}')">×</button>
        </div>`).join("")
    : `<div class="empty-hint">No features assigned to this function group.</div>`;

    return `
      <div class="modal-head">
        <button class="icon-edit-btn" id="fnIconBtn">${OL.iconHTML(fn)}</button>
        <div class="modal-title-text"
          id="fnName"
          contenteditable="true"
          data-placeholder="New Function">
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
              Ctrl+ click pill to cycle status, right-click to remove mapping.
            </div>
          </div>
          <div class="modal-pill-box" id="fnAppPills"></div>
          <button class="btn small soft" id="fnAssignBtn">+ Assign Apps</button>
        </div>
        <div>
            <label class="modal-section-label">Associated Features</label>
            <div id="fnFeaturePills" class="modal-pill-box">
                ${featuresHTML}
            </div>
            <button class="btn xsmall soft" id="btnFnAddFeature">+ Add Feature</button>
        </div>
      </div>
    `;
  }

  function renderFunctionModalPills(fnId) {
    const fn = findFunctionById(fnId);
    if (!fn) return;

    const layer = getModalLayer();
    if (!layer) return;
    const box = layer.querySelector("#fnAppPills");
    if (!box) return;

    const links = sortByStatusStable(
      OL.functionAssignments(fn.id),
      (l) => l.status,
      (l) =>
        l.app && typeof l.app._stableIndex === "number"
          ? l.app._stableIndex
          : 0,
    );

    if (!links.length) {
      box.innerHTML = `<span class="pill muted">No apps mapped</span>`;
      return;
    }

    box.innerHTML = links
      .map((l) => {
        if (!l.app) return "";
        const status = normalizeStatus(l.status);
        return `
          <span
            class="pill fn status-${status}"
            data-app-id="${l.app.id}"
            onclick="OL._handleFnAppPill(event, '${l.app.id}', '${fn.id}')"
            oncontextmenu="OL.removeFunctionFromApp(event, '${l.app.id}', '${fn.id}')"
          >
            ${esc(l.app.name || "")}
          </span>
        `;
      })
      .join("");
  }

  function bindFunctionModal(fnOrId, isNew, appIdToAssign = null) {
    let fn;
    
    if (typeof fnOrId === 'string') {
        fn = findFunctionById(fnOrId);
    } else {
        fn = fnOrId; // It's the draft object
    }
    
    if (!fn) return; // Safety check

    let created = !fn._draft;

    const layer = getModalLayer();
    if (!layer) return;

    const nameEl = layer.querySelector("#fnName");

    const iconBtn = layer.querySelector("#fnIconBtn");
    const notesEl = layer.querySelector("#fnNotes");
    const assignBtn = layer.querySelector("#fnAssignBtn");

   function commitIfNeeded(val) {
        if (created || !val) return;
        created = true;
        delete fn._draft;
        
        // Push to state only if it was a draft and is now committed
        if (typeof fnOrId !== 'string') {
            state.functions.push(fn); 
        }

        // --- NEW APP ASSIGNMENT LOGIC (Mirroring App Modal Fix) ---
        if (appIdToAssign) {
            const app = findAppById(appIdToAssign);
            if (app) {
                app.functions = app.functions || [];
                
                // Check if the assignment already exists
                if (!app.functions.some(r => r.fnId === fn.id)) {
                    const isFirst = OL.functionAssignments(fn.id).length === 0;
                    const status = isFirst ? "primary" : "available";
                    app.functions.push({ fnId: fn.id, status });
                }
            }
        }
        // --- END NEW APP ASSIGNMENT LOGIC ---

        OL.persist();
    }
    // --- 3. binder events AFTER blanking
    if (nameEl) {
      nameEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          nameEl.blur();
        }
      });

      nameEl.addEventListener("blur", () => {
        const val = nameEl.textContent.trim();
        if (!val || val === "New Function") return;

        commitIfNeeded(val);
        fn.name = val;
        OL.persist();
        delayedSortRenders();
      });

      nameEl.addEventListener("input", () => {
        if (nameEl.innerHTML === "<br>" || nameEl.textContent.trim() === "") {
          nameEl.innerHTML = "";
        }
      });
    }

    // --- 4. NOW declare and run placeholder logic
    function updatePlaceholder(el) {
      el.dataset.empty = el.textContent.trim() === "" ? "true" : "false";
    }

    if (nameEl) {
      nameEl.addEventListener("input", () => updatePlaceholder(nameEl));

      // initial paint check only
      requestAnimationFrame(() => updatePlaceholder(nameEl));
    }

    if (iconBtn) {
      iconBtn.onclick = (e) => {
        e.stopPropagation();
        openIconPicker(fn, () => {
          delayedSortRenders();
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

    renderFunctionModalPills(fn.id);

    if (assignBtn) {
      assignBtn.onclick = (e) => {
        e.stopPropagation();
        openFunctionAppAssignUI(fn.id);
      };
    }

    const addFeatureBtn = layer.querySelector("#btnFnAddFeature");
    
    if (addFeatureBtn) {
    addFeatureBtn.onclick = (e) => {
        e.stopPropagation();
        
        const options = (state.features || []).map(f => ({
            id: f.id,
            label: f.name,
            checked: f.functionId === fn.id
        }));

      openMappingDropdown({
                anchorEl: addFeatureBtn,
                options: options,
                allowMultiple: false, // Usually a feature belongs to one group
                injectOnEmpty: {
                    text: "+ Create & Link Feature: {query}",
                    onClick: (name) => {
                        const newFeature = {
                            id: uid(),
                            name: name,
                            functionId: fn.id, // Auto-assign to this group
                            category: null
                        };
                        state.features.push(newFeature);
                        OL.persist();
                        OL.openFunctionModal(fn.id); // Refresh
                        renderFeaturesGrid(); // Update background grid
                    }
                },
                onSelect: (featureId) => {
                    const feature = state.features.find(f => f.id === featureId);
                    if (feature) {
                        feature.functionId = fn.id;
                        feature.category = null;
                        OL.persist();
                        OL.openFunctionModal(fn.id);
                        renderFeaturesGrid();
                    }
                }
            });
        };
    }
  }
  OL.removeFeatureFromFunction = function(featureId) {
    const feature = state.features.find(f => f.id === featureId);
    if (feature) {
        const oldFnId = feature.functionId;
        feature.functionId = null;
        feature.category = "General"; // Default fallback
        OL.persist();
        if (oldFnId) OL.openFunctionModal(oldFnId);
        renderFeaturesGrid();
    }
  };

  function openFunctionAppAssignUI(fnId) { // <-- Rename argument to 'functionId' to avoid internal conflict
    
    // 1. Get the Function Object
    const fn = findFunctionById(fnId); // Get the object needed for lookup/filtering
    if (!fn) return;
    
    // 2. Extract the actual ID for closure reference
    const currentFnId = fn.id; // <-- The ID we need to use everywhere else

    const layer = getModalLayer();
    const assignBtn = layer.querySelector("#fnAssignBtn");
    if (!assignBtn) return;

      // We filter state.apps before mapping to prevent mapping over null/corrupted apps
      const opts = state.apps
          .filter(Boolean) 
          .map((appObj) => {
              // fn is now guaranteed not to be null here.
              const isChecked = (appObj.functions || []).some((r) => r.fnId === fn.id); 
              
              return {
                  id: appObj.id,
                  label: appObj.name,
                  checked: isChecked,
              };
          });

          // 1. Define the callback for adding a NEW App
          const addNewApp = (name) => { 
              const draftApp = {
                    id: uid(),
                    name: name || "New App", // Use search query as starting name
                    notes: "",
                    icon: null,
                    functions: [], // Initialize functions array
                  _draft: true,
              };
              
              // Open the App Modal, passing the Function ID for auto-assignment upon save.
              // We use the draft object and set isNew=true.
              OL.openAppModal(draftApp, true, currentFnId); // <-- Use currentFnId here
          };

          openMappingDropdown({
            anchorEl: assignBtn,
            options: opts,
            allowMultiple: true,
        
        // 2. Add the custom creation button injection
        injectOnEmpty: {
            text: "+ Create New App: {query}", 
            onClick: addNewApp 
        },
        
        onSelect: (appId, isChecked) => {
          const appToUpdate = findAppById(appId);
          if (!appToUpdate) return;

          const app = appToUpdate;

          if (isChecked) {
            app.functions = app.functions || [];
           // Use the reliably captured currentFnId from the outer scope:
                  if (!app.functions.find((r) => r.fnId === currentFnId)) {
                      const isFirst = OL.functionAssignments(currentFnId).length === 0;
                      const status = isFirst ? "primary" : "available";
                      app.functions.push({ fnId: currentFnId, status });
                  }
              } else {
                  app.functions = (app.functions || []).filter((r) => r.fnId !== currentFnId);
              }

              OL.persist();
              renderFunctionModalPills(currentFnId); 
              renderAppModalFunctionPills(app);
              delayedSortRenders();

              // Re-fetch the dropdown element dynamically and refresh
              const dd = document.querySelector(".mapping-dropdown");
              if (dd && dd.refresh) dd.refresh();
        },
      });
  }

  // ------------------------------------------------------------
  // TEAM MEMBER MODAL
  // ------------------------------------------------------------
  OL.openTeamMemberModal = function (memberOrId, isNew = false) {
    let member;

    // Existing member
    if (typeof memberOrId === "string") {
      member = findTeamMemberById(memberOrId);
    } else {
      member = memberOrId;
    }

    // NEW MEMBER → Create draft
    if (!member) {
      member = {
        id: uid(),
        _draft: true,
        name: "",
        title: "",
        email: "",
        notes: "",
        roles: [],
      };
      // DO NOT push to state yet
    }

    activeOnClose = null;

    openModal(renderTeamMemberModalHTML(member));
    setTimeout(() => bindTeamMemberModal(member, isNew), 0);
  };

  function renderTeamMemberModalHTML(member) {
    return `
      <div class="modal-head">
        <button class="icon-edit-btn" id="teamMemberIconBtn">${OL.iconHTML(member)}</button>
        <div class="modal-title-text"
          id="teamMemberName"
          contenteditable="true"
          data-placeholder="New Team Member">
          ${member.name ? esc(member.name) : ""}
        </div>
        <div class="spacer"></div>
        <button class="btn small soft" onclick="OL.closeModal()">Close</button>
      </div>
      <div class="modal-body">
        <div>
          <label class="modal-section-label">Title</label>
          <input 
            id="teamMemberTitle" 
            class="modal-textarea" 
            style="min-height:auto;height:auto;"
            value="${esc(member.title || "")}">
        </div>
        <div>
          <label class="modal-section-label">Email</label>
          <input 
            id="teamMemberEmail" 
            class="modal-textarea" 
            style="min-height:auto;height:auto;"
            value="${esc(member.email || "")}">
        </div>
        <div>
          <label class="modal-section-label">Notes</label>
          <textarea id="teamMemberNotes" class="modal-textarea">${esc(member.notes || "")}</textarea>
        </div>
        <div>
          <label class="modal-section-label">Roles</label>
          <div class="modal-pill-box" id="teamMemberRolePills"></div>
          <button class="btn small soft" id="teamMemberAssignRoleBtn">+ Assign Roles</button>
        </div>
        ${renderTeamMemberAccessSection(member)}
      </div>
    `;
  }

  function renderTeamMemberAccessSection(member) {
      // Find all apps where this member is listed in the 'access' array
      const appsWithAccess = (window.OL.state.apps || []).filter(app => 
          (app.access || []).some(acc => acc.memberId === member.id)
      );

      return `
          <div class="modal-section"">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                  <label class="modal-section-label">Application Access Profile</label>
                  <button class="btn xsmall soft" onclick="OL.openAppAccessDropdown(event, '${member.id}')">+ Add App Access</button>
              </div>
              <div class="access-table-header">
                  <div style="width: 120px;">Application</div>
                  <div style="width: 100px;">Level</div>
                  <div style="flex: 1;">Notes / API Credentials</div>
              </div>
              <div class="access-table-body">
                  ${appsWithAccess.map(app => {
                      const accessEntry = app.access.find(a => a.memberId === member.id);
                      return `
                          <div class="access-table-row">
                              <div class="access-app-pill"
                                onclick="OL.closeModal(); setTimeout(() => OL.openAppModal('${app.id}'), 50)">
                                ${OL.utils.esc(app.name)}
                              </div>
                              <div class="access-cell-level" 
                                  contenteditable="true" 
                                  onblur="OL.updateAccessFromTeam('${app.id}', '${member.id}', 'level', this.textContent)">
                                  ${OL.utils.esc(accessEntry.level || 'User')}
                              </div>
                              <div class="access-cell-notes" 
                                  contenteditable="true" 
                                  onblur="OL.updateAccessFromTeam('${app.id}', '${member.id}', 'notes', this.textContent)">
                                  ${OL.utils.esc(accessEntry.notes || '')}
                              </div>
                              <div class="muted clickable" onclick="OL.revokeAccess('${app.id}', '${member.id}')" style="padding:0 5px;">×</div>
                          </div>
                      `;
                  }).join('')}
                  ${appsWithAccess.length === 0 ? '<div class="empty-hint">No app access assigned.</div>' : ''}
              </div>
          </div>
      `;
  }

  // 1. Add App Access from Team Card
  OL.openAppAccessDropdown = function(e, memberId) {
      const options = (window.OL.state.apps || []).map(app => ({
          id: app.id,
          label: app.name
      }));

      openMappingDropdown({
          anchorEl: e.currentTarget,
          options: options,
          onSelect: (appId) => {
              const app = window.OL.state.apps.find(a => a.id === appId);
              if (!app) return;
              
              app.access = app.access || [];
              if (app.access.some(a => a.memberId === memberId)) return;

              app.access.push({ memberId: memberId, level: "User", notes: "" });
              OL.persist();
              
              // Re-render the Team modal to show the new row
              const member = window.OL.state.teamMembers.find(m => m.id === memberId);
              openModal(renderTeamMemberModalHTML(member));
              bindTeamMemberModal(member);
          }
      });
  };

  // 2. Universal Sync Function
  OL.updateAccessFromTeam = function(appId, memberId, field, value) {
      const app = window.OL.state.apps.find(a => a.id === appId);
      const entry = app?.access?.find(a => a.memberId === memberId);
      if (entry) {
          entry[field] = value.trim();
          OL.persist();
          // Since data is shared, this change is already "at" the App card too!
      }
  };

  // 3. Revoke Access
  OL.revokeAccess = function(appId, memberId) {
      if (!confirm("Revoke this member's access to the application?")) return;
      const app = window.OL.state.apps.find(a => a.id === appId);
      if (app) {
          app.access = app.access.filter(a => a.memberId !== memberId);
          OL.persist();
          const member = window.OL.state.teamMembers.find(m => m.id === memberId);
          openModal(renderTeamMemberModalHTML(member));
          bindTeamMemberModal(member);
      }
  };

  function renderTeamMemberRolePills(member) {
    const layer = getModalLayer();
    if (!layer) return;
    const box = layer.querySelector("#teamMemberRolePills");
    if (!box) return;

    const roles = (member.roles || [])
      .map((r) => findTeamRoleById(r.roleId))
      .filter(Boolean);

    if (!roles.length) {
      box.innerHTML = `<span class="pill muted">No roles assigned</span>`;
      return;
    }

    box.innerHTML = roles
      .map(
        (role) => `
        <span
          class="pill fn"
          oncontextmenu="OL.removeRoleFromMember(event, '${member.id}', '${role.id}')"
          onclick="event.stopPropagation(); OL.openTeamRoleModal('${role.id}')"  >
          ${esc(role.name || "")}
        </span>
      `,
      )
      .join("");
  }

  function bindTeamMemberModal(member, isNew) {
    const layer = getModalLayer();
    if (!layer) return;

    let created = !member._draft;

    // closing without naming → discard
    activeOnClose = () => {
      if (member._draft) return;
    };

    function commitIfNeeded(val) {
      if (created || !val) return;
      created = true;
      delete member._draft;
      state.teamMembers.push(member);
      OL.persist();
    }

    // ⬇️ PLACEHOLDER LOGIC START ⬇️
    function updatePlaceholder(el) {
      el.dataset.empty = el.textContent.trim() === "" ? "true" : "false";
    }
    // ⬆️ PLACEHOLDER LOGIC END ⬆️

    const nameEl = layer.querySelector("#teamMemberName");
    const iconBtn = layer.querySelector("#teamMemberIconBtn");
    const titleEl = layer.querySelector("#teamMemberTitle");
    const emailEl = layer.querySelector("#teamMemberEmail");
    const notesEl = layer.querySelector("#teamMemberNotes");
    const assignBtn = layer.querySelector("#teamMemberAssignRoleBtn");

    // PLACEHOLDER initial state
    if (isNew && nameEl) {
      nameEl.textContent = "";
    }

    if (nameEl) {
      // ⬇️ PLACEHOLDER ACTIVATION ⬇️
      nameEl.addEventListener("input", () => updatePlaceholder(nameEl));
      requestAnimationFrame(() => updatePlaceholder(nameEl));
      // ⬆️ PLACEHOLDER ACTIVATION ⬆️

      nameEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          nameEl.blur();
        }
      });

      nameEl.addEventListener("blur", () => {
        const newName = nameEl.textContent.trim();
        if (!newName || newName === "New Team Member") return;

        commitIfNeeded(newName);
        member.name = newName;
        OL.persist();
        renderTeamMembersGrid();
        renderTeamRolesGrid();
      });

      // clean empty content
      nameEl.addEventListener("input", () => {
        if (nameEl.innerHTML === "<br>" || nameEl.textContent.trim() === "") {
          nameEl.innerHTML = "";
        }
      });
    }

    if (iconBtn) {
      iconBtn.onclick = (e) => {
        e.stopPropagation();
        openIconPicker(member, () => {
          renderTeamMembersGrid();
          OL.openTeamMemberModal(member.id);
        });
      };
    }

    if (titleEl) {
      titleEl.addEventListener(
        "input",
        debounce(() => {
          if (!member._draft) {
            member.title = titleEl.value.trim();
            OL.persist();
            renderTeamMembersGrid();
          }
        }, 200),
      );
    }

    if (emailEl) {
      emailEl.addEventListener(
        "input",
        debounce(() => {
          if (!member._draft) {
            member.email = emailEl.value.trim();
            OL.persist();
            renderTeamMembersGrid();
          }
        }, 200),
      );
    }

    if (notesEl) {
      notesEl.addEventListener(
        "input",
        debounce(() => {
          if (!member._draft) {
            member.notes = notesEl.value;
            OL.persist();
            renderTeamMembersGrid();
          }
        }, 200),
      );
    }

    renderTeamMemberRolePills(member);

    if (assignBtn) {
      assignBtn.onclick = (e) => {
        e.stopPropagation();
        openTeamMemberRoleAssignUI(member);
      };
    }
  }

  function openTeamMemberRoleAssignUI(member) {
    const layer = getModalLayer();
    const anchor = layer.querySelector("#teamMemberAssignRoleBtn");
    if (!anchor) return;

    const opts = (state.teamRoles || []).map((role) => {
      const isChecked = (member.roles || []).some((r) => r.roleId === role.id);
      return {
        id: role.id,
        label: role.name || "",
        checked: isChecked,
      };
    });

    openMappingDropdown({
      anchorEl: anchor,
      options: opts,
      allowMultiple: true,
      onSelect: (roleId, isChecked) => {
        member.roles = member.roles || [];

        if (isChecked) {
          if (!member.roles.find((r) => r.roleId === roleId)) {
            member.roles.push({ roleId });
          }
        } else {
          member.roles = member.roles.filter((r) => r.roleId !== roleId);
        }

        OL.persist();
        renderTeamMemberRolePills(member);
        renderTeamMemberPills(role);
        renderTeamMembersGrid();
        renderTeamRolesGrid();

        const dd = document.querySelector(".mapping-dropdown");
        if (dd && dd.refresh) dd.refresh();
      },
    });
  }

  OL.removeRoleFromMember = function (e, memberId, roleId) {
    e.preventDefault();
    e.stopPropagation();

    const member = findTeamMemberById(memberId);
    if (!member) return;

    member.roles = (member.roles || []).filter((r) => r.roleId !== roleId);
    OL.persist();
    renderTeamMembersGrid();
    renderTeamRolesGrid();

    const layer = getModalLayer();
    if (layer && layer.style.display === "flex") {
      renderTeamMemberRolePills(member);
    }
  };

  OL.deleteTeamMember = function (memberId) {
    const member = findTeamMemberById(memberId);
    if (!member) return;
    if (!confirm(`Delete team member "${member.name || ""}"?`)) return;

    state.teamMembers = (state.teamMembers || []).filter(
      (m) => m.id !== memberId,
    );
    OL.persist();
    renderTeamMembersGrid();
    renderTeamRolesGrid();
  };

  // ------------------------------------------------------------
  // TEAM ROLE MODAL
  // ------------------------------------------------------------
  OL.openTeamRoleModal = function (roleOrId, isNew = false) {
    const role =
      typeof roleOrId === "string" ? findTeamRoleById(roleOrId) : roleOrId;

    activeOnClose = null;
    openModal(renderTeamRoleModalHTML(role));
    setTimeout(() => bindTeamRoleModal(role, isNew), 0);
  };

  // --- NEW HELPER FUNCTION ---
  function renderTeamMemberPillsForRole(roleId) {
      const assignments = teamAssignmentsForRole(roleId);
      
      if (!assignments.length) {
          return `<span class="pill muted">No members currently assigned to this role.</span>`;
      }

      return assignments.map(({ member }) => `
          <span
            class="pill fn"
            onclick="event.stopPropagation(); OL.openTeamMemberModal('${member.id}')"
          >
            ${esc(member.name || "")}
          </span>
      `).join("");
  }
  // ---------------------------

  function renderTeamRoleModalHTML(role) {
    const assignments = teamAssignmentsForRole(role.id);

    const usageHTML = assignments.length
      ? `
        <div class="dp-table">
          <div class="dp-table-header">
            <span>Team Member</span>
          </div>
          ${assignments
            .map(
              ({ member }) => `
                <span class="modal-pill-box"
                onclick="event.stopPropagation(); OL.openTeamMemberModal('${member.id}')">
                  ${esc(member.name || "")}
                </span>
            `,
            )
            .join("")}
        </div>
      `
      : `<div class="empty-hint">No team members currently have this role.</div>`;

    return `
      <div class="modal-head">
        <div class="modal-title-text"
          id="teamRoleName"
          contenteditable="true"
          data-placeholder="New Role">
          ${esc(role.name || "")}
        </div>
        <div class="spacer"></div>
        <button class="btn small soft" onclick="OL.closeModal()">Close</button>
      </div>
      <div class="modal-body">
      <div>
        <label class="modal-section-label">Description</label>
        <textarea id="teamRoleDesc" class="modal-textarea">${esc(role.description || "")}</textarea>
      </div>
      <div>
        <label class="modal-section-label">Notes</label>
        <textarea id="teamRoleNotes" class="modal-textarea">${esc(role.notes || "")}</textarea>
      </div>
      
      <div>
        <label class="modal-section-label">Used by team members</label>
        <div class="modal-pill-box" id="teamMemberPillsForRole">
          ${renderTeamMemberPillsForRole(role.id)} 
        </div>
        </div>
      </div>
  `;
  }
  function bindTeamRoleModal(role, isNew) {
    const layer = getModalLayer();
    if (!layer) return;

    let created = !role._draft;

    // Handles closing without name → discard
    activeOnClose = () => {
      if (role._draft) return;
    };

    function commitIfNeeded(val) {
      if (created || !val) return;
      created = true;
      delete role._draft;
      state.teamRoles.push(role);
      OL.persist();
    }

    // ⬇️ PLACEHOLDER LOGIC START ⬇️
    function updatePlaceholder(el) {
      el.dataset.empty = el.textContent.trim() === "" ? "true" : "false";
    }
    // ⬆️ PLACEHOLDER LOGIC END ⬆️

    const nameEl = layer.querySelector("#teamRoleName");
    const descEl = layer.querySelector("#teamRoleDesc");
    const notesEl = layer.querySelector("#teamRoleNotes");

    // PLACEHOLDER create logic (blank name at open)
    if (isNew && nameEl) {
      nameEl.textContent = "";
      // The original code tried to call a non-existent global function here.
      // We will rely on the requestAnimationFrame below to run the initial check.
    }

    if (nameEl) {
      // ⬇️ PLACEHOLDER ACTIVATION ⬇️
      nameEl.addEventListener("input", () => updatePlaceholder(nameEl));
      requestAnimationFrame(() => updatePlaceholder(nameEl));
      // ⬆️ PLACEHOLDER ACTIVATION ⬆️

      nameEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          nameEl.blur();
        }
      });

      nameEl.addEventListener("blur", () => {
        const newName = nameEl.textContent.trim();
        if (!newName || newName === "New Team Role") return;

        commitIfNeeded(newName);
        role.name = newName;
        OL.persist();
        renderTeamRolesGrid();
        renderTeamMembersGrid();
      });

      // keep editable clean of stray <br>
      nameEl.addEventListener("input", () => {
        if (nameEl.innerHTML === "<br>" || nameEl.textContent.trim() === "") {
          nameEl.innerHTML = "";
        }
      });
    }

    if (descEl) {
      descEl.addEventListener(
        "input",
        debounce(() => {
          role.description = descEl.value;
          OL.persist();
          renderTeamRolesGrid();
        }, 200),
      );
    }

    if (notesEl) {
      notesEl.addEventListener(
        "input",
        debounce(() => {
          role.notes = notesEl.value;
          OL.persist();
          renderTeamRolesGrid();
        }, 200),
      );
    }

    layer.querySelectorAll(".dp-link-team-member").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const id = el.getAttribute("data-member-id");
        if (id) {
          OL.closeModal();
          OL.openTeamMemberModal(id);
        }
      };
    });
  }

  OL.deleteTeamRole = function (roleId) {
    const role = findTeamRoleById(roleId);
    if (!role) return;
    if (!confirm(`Delete role "${role.name || ""}"?`)) return;

    // strip role from all members
    (state.teamMembers || []).forEach((member) => {
      member.roles = (member.roles || []).filter((r) => r.roleId !== roleId);
    });

    state.teamRoles = (state.teamRoles || []).filter((r) => r.id !== roleId);
    OL.persist();
    renderTeamRolesGrid();
    renderTeamMembersGrid();
  };

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
                    cap.key ||
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
                        placeholder="App capability name (e.g. 'New Contact in App')"
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
      <input 
        id="intCapAppLabel" 
        class="modal-textarea" 
        style="min-height:auto;height:auto;"
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

  OL.openDatapointModal = function (dp, isNew = false) {
      activeOnClose = null;

      // Get unique existing object types from state to populate the dropdown
      const existingTypes = [...new Set(state.datapoints.map(d => d.objectType || "General"))];
      if (!existingTypes.includes("Contact")) existingTypes.push("Contact");
      if (!existingTypes.includes("Household")) existingTypes.push("Household");
      if (!existingTypes.includes("Account")) existingTypes.push("Account");
      
      const typeOptions = existingTypes
          .sort()
          .map(type => `<option value="${type}" ${dp.objectType === type ? 'selected' : ''}>${type}</option>`)
          .join("");

      openModal(`
        <div class="modal-head">
          <div class="modal-title-text" id="dpName" contenteditable="true" data-placeholder="New Datapoint">
            ${esc(dp.name || "")}
          </div>
          <div class="spacer"></div>
          <button class="btn small soft" onclick="OL.closeModal()">Close</button>
        </div>
        <div class="modal-body">
          <div class="modal-row">
              <div class="modal-column">
                  <label class="modal-section-label">Object Type</label>
                  <select id="dpObjectType" class="modal-select">
                      ${typeOptions}
                  </select>
              </div>
          </div>

          <label class="modal-section-label">Description</label>
          <textarea id="dpDesc" class="modal-textarea" style="min-height:60px;">${esc(dp.description || "")}</textarea>

          <label class="modal-section-label">Used in applications</label>
          <div id="dpMappingsTable">
            ${renderDatapointModalTable(dp)}
          </div>
        </div>
      `);

      setTimeout(() => bindDatapointModal(dp, isNew), 0);
  };

  function bindDatapointModal(dp, isNew) {
    const layer = getModalLayer();
    if (!layer) return;

    let created = !dp._draft;

    if (isNew) {
      const nameEl = layer.querySelector("#dpName");
      if (nameEl) nameEl.textContent = "";
    }

    activeOnClose = () => {
      if (dp._draft) return;
    };

    function commitIfNeeded(val) {
      if (created || !val) return;
      created = true;
      delete dp._draft;
      state.datapoints.push(dp);
      OL.persist();
    }

    // ⬇️ PLACEHOLDER LOGIC START ⬇️
    function updatePlaceholder(el) {
      el.dataset.empty = el.textContent.trim() === "" ? "true" : "false";
    }
    // ⬆️ PLACEHOLDER LOGIC END ⬆️

    const nameEl = layer.querySelector("#dpName");
    const descEl = layer.querySelector("#dpDesc");
    const objectTypeEl = layer.querySelector("#dpObjectType");

    if (nameEl) {
      // ⬇️ PLACEHOLDER ACTIVATION ⬇️
      nameEl.addEventListener("input", () => updatePlaceholder(nameEl));
      requestAnimationFrame(() => updatePlaceholder(nameEl));
      // ⬆️ PLACEHOLDER ACTIVATION ⬆️

      nameEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          nameEl.blur();
        }
      });

      nameEl.addEventListener("blur", () => {
        const val = nameEl.textContent.trim();
        if (!val || val === "New Datapoint") return;

        commitIfNeeded(val);
        dp.name = val;
        OL.persist();
        renderDatapointsGrid();
      });

      nameEl.addEventListener("input", () => {
        if (nameEl.innerHTML === "<br>" || nameEl.textContent.trim() === "") {
          nameEl.innerHTML = "";
        }
      });
    }

    if (descEl) {
      descEl.addEventListener(
        "input",
        debounce(() => {
          dp.description = descEl.value;
          OL.persist();
        }, 200),
      );
    }

    if (objectTypeEl) {
        objectTypeEl.onchange = () => {
            const newVal = objectTypeEl.value;
            dp.objectType = newVal;
            
            // COMMIT if it's a new draft being assigned a category for the first time
            if (isNew && dp.name) {
                commitIfNeeded(dp.name);
            }
            
            OL.persist();
            renderDatapointsGrid(); // Refresh sidebar and grid to reflect movement
        };
    }

    layer.querySelectorAll(".dp-link-app").forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        OL.closeModal();
        OL.openAppModal(el.getAttribute("data-app-id"));
      };
    });
  }

  // ------------------------------------------------------------
  // CAPABILITY MODAL
  // ------------------------------------------------------------
  OL.openCapabilityModal = function (capOrId, isNew = false) {
    let cap =
      typeof capOrId === "string"
        ? state.capabilities.find((c) => c.id === capOrId)
        : capOrId;

    if (!cap) {
      cap = {
        id: uid(),
        _draft: true,
        name: "",
        canonical: "",
        type: "trigger",
        integrationType: "zapier",
        notes: "",
        appId: null,
        canonicalId: null,
      };
      // IMPORTANT: DO NOT push into state yet
    }

    activeOnClose = null;

    openModal(renderCapabilityModalHTML(cap, true));
    bindCapabilityModal(cap, true);
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
              <div id="capName"
                  class="modal-title-text"
                  contenteditable="true"
                  data-placeholder="New Capability Name">
                  ${esc(cap.name || "")} </div>
              <div class="spacer"></div>
              <button class="btn small soft" onclick="OL.closeModal()">Close</button>
          </div>
          
          <div class="modal-body">

              <label class="modal-section-label">Canonical Key</label>
              <div class="canon-wrapper">
                  <input  
                      id="canonInput"  
                      class="canon-input"  
                      placeholder="Search or add canonical key…"  
                      autocomplete="off">

                  <div id="canonDropdown" class="canon-dropdown hidden">
                      <input
                          id="canonSearch"  
                          class="canon-search"  
                          placeholder="Search…"  
                          autocomplete="off">
                      <div id="canonOptions" class="canon-options"></div>
                      <div id="canonAddNew" class="canon-add">+ Add New</div>
                  </div>
              </div>
              <div class="modal-notes-display small muted" style="margin-bottom: 20px;">
                  Canonical capabilities are app-agnostic definitions like “New Contact Created” or “Meeting Scheduled”.
              </div>
              
              <div class="modal-row" style="gap: 20px;">
                  <div class="modal-column">
                      <label class="modal-section-label">Integration Type</label>
                      <select
                          id="capIntegrationType"
                          class="modal-textarea"
                          style="min-height:auto;height:auto;"
                      >
                          <option value="direct" ${integrationType === "direct" ? "selected" : ""}>Direct</option>
                          <option value="zapier" ${integrationType === "zapier" ? "selected" : ""}>Zapier</option>
                          <option value="both" ${integrationType === "both" ? "selected" : ""}>Both</option>
                      </select>
                  </div>

                  <div class="modal-column">
                      <label class="modal-section-label">Type</label>
                      <select
                          id="capType"
                          class="modal-textarea"
                          style="min-height:auto;height:auto;"
                      >
                          <option value="trigger" ${type === "trigger" ? "selected" : ""}>Trigger</option>
                          <option value="search" ${type === "search" ? "selected" : ""}>Search</option>
                          <option value="action" ${type === "action" ? "selected" : ""}>Action</option>
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

  function bindCapabilityModal(cap, isNew) {
    const layer = getModalLayer();
    if (!layer) return;

    let created = !cap._draft;

    activeOnClose = () => {
      if (cap._draft) {
        // discard
        state.capabilities = (state.capabilities || []).filter(
          (x) => x !== cap,
        );
        renderCapabilitiesGrid();
      }
    };

    function commitIfNeeded(val) {
      if (created || !val) return;
      created = true;
      delete cap._draft;

      state.capabilities = state.capabilities || [];
      state.capabilities.push(cap);

      OL.persist();
      renderCapabilitiesGrid();
    }

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
          (a.key || "")
            .toLowerCase()
            .localeCompare((b.key || "").toLowerCase()),
        );

      canonOptions.innerHTML = list
        .map(
          (c) => `
        <div class="canon-option" data-id="${c.id}">${esc(c.key || "")}</div>
      `,
        )
        .join("");

      canonOptions.querySelectorAll(".canon-option[data-id]").forEach((opt) => {
        opt.onclick = (e) => {
          e.stopPropagation();
          const id = opt.getAttribute("data-id");
          const canon = findCanonicalById(id);
          if (!canon) return;

          if (cap._draft) {
            cap.canonicalId = canon.id;
            cap.canonical = canon.key;
            hideCanonDropdown();
            syncCanonInput();
            return;
          }

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
              type: (typeEl && typeEl.value) || cap.type || "trigger",
              notes: "",
              group: "",
            };
            state.canonicalCapabilities = state.canonicalCapabilities || [];
            state.canonicalCapabilities.push(canon);
          }

          if (cap._draft) {
            // just attach, don’t push anything yet
            cap.canonicalId = canon.id;
            cap.canonical = canon.key;
            hideCanonDropdown();
            syncCanonInput();
            return;
          } // otherwise normal push + persist
        };
      }

      canonDropdown.addEventListener("click", (e) => e.stopPropagation());
    }

    if (nameEl) {
      nameEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          nameEl.blur();
        }
      });

      nameEl.addEventListener("blur", () => {
        const v = nameEl.value.trim();
        if (!v || v === "New Capability") return;

        // COMMIT the draft
        commitIfNeeded(v);

        if (!cap._draft && !cap.canonicalId && v) {
          // create canonical lazily
          const canon = {
            id: uid(),
            key: v,
            type: cap.type || "trigger",
            notes: "",
            group: "",
          };
          state.canonicalCapabilities = state.canonicalCapabilities || [];
          state.canonicalCapabilities.push(canon);

          cap.canonicalId = canon.id;
          cap.canonical = canon.key;
        }

        // assign the name
        cap.name = v;
        cap.key = v; // keep consistent
        cap.canonical = v; // match canonical concept

        OL.persist();
        renderCapabilitiesGrid();
      });

      nameEl.addEventListener("input", () => {
        if (nameEl.value === "<br>" || nameEl.value.trim() === "") {
          nameEl.value = "";
        }
      });
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
    // Also remove datapoint mappings for this app
    state.datapoints.forEach((dp) => {
      dp.appMappings = (dp.appMappings || []).filter((m) => m.appId !== appId);
    });

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
    const dp = state.datapoints.find((d) => d.id === dpId);
    if (!dp) return;
    if (
      !confirm(
        `Delete global datapoint "${dp.name}"? This will remove all associated app mappings.`,
      )
    )
      return;

    state.datapoints = state.datapoints.filter((d) => d.id !== dpId);

    // Remove all mappings that reference this deleted Datapoint ID
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

    if (app) renderAppModalFunctionPills(app);
    if (fn) renderFunctionModalPills(fnId);

    delayedSortRenders();
  };

  OL.cycleFunctionStatus = function (e, appId, fnId) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // 1. DATA: Update global state
    const app = state.apps.find(a => a.id === appId);
    if (!app) return;
    const ref = (app.functions || []).find(r => r.fnId === fnId);
    if (!ref) return;

    const cycle = ["available", "evaluating", "primary"];
    const current = (ref.status || "available").toLowerCase();
    const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];

    ref.status = next;
    OL.persist(); 

    // 2. UI: Find and Clean the Pill
    const pill = e ? e.target.closest('.pill.fn') : document.querySelector(`.pill.fn[data-app-id="${appId}"][data-fn-id="${fnId}"]`);
    
    if (pill) {
        // STRATEGY: Remove anything that looks like a status class
        // This clears 'available', 'status-available', 'evaluating', etc.
        const classesToRemove = ['available', 'evaluating', 'primary', 'status-available', 'status-evaluating', 'status-primary'];
        pill.classList.remove(...classesToRemove);
        
        // Apply the new one (using the prefix your CSS seems to expect)
        pill.classList.add(next);
        pill.classList.add(`status-${next}`);

        // Sync the internal dot too
        const dot = pill.querySelector('.dot');
        if (dot) {
            dot.classList.remove(...classesToRemove);
            dot.classList.add(next);
        }

        console.log(`Pill scrubbed and updated to: ${next}`);
    }
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
  function openMappingDropdown({ anchorEl, options, allowMultiple, onSelect, injectOnEmpty = null }) {
      // 1. Clean up existing dropdowns
      let existing = document.querySelector(".mapping-dropdown");
      if (existing) existing.remove();

      const dropdown = document.createElement("div");
      dropdown.className = "mapping-dropdown";

      // 2. Decide if we show the search box (only for long lists)
      const showSearch = options.length > 5;

      dropdown.innerHTML = `
          ${showSearch ? '<input class="mapping-search" placeholder="Search…">' : ''}
          <div class="mapping-options" style="${!showSearch ? 'padding-top: 4px;' : ''}"></div>
      `;

      document.body.appendChild(dropdown);

      // 3. Position the dropdown
      const rect = anchorEl.getBoundingClientRect();
      dropdown.style.left = rect.left + "px";
      dropdown.style.top = rect.bottom + "px";

      const search = dropdown.querySelector(".mapping-search");
      const optionsBox = dropdown.querySelector(".mapping-options");

      // 4. Define the Render Logic
      function renderList() {
          const q = search ? search.value.toLowerCase().trim() : "";
          optionsBox.innerHTML = "";

          // Filter existing options
          const searchableOptions = options.filter((o) =>
              (o.label || "").toLowerCase().includes(q),
          );

          // Render filtered options
          searchableOptions.forEach((o) => {
              if (!allowMultiple && o.checked) return; 

              const row = document.createElement("div");
              row.className = "mapping-option";
              
              if (allowMultiple) {
                  row.innerHTML = `<span class="mapping-multi-label ${o.checked ? "checked" : ""}">
                      ${o.label}
                  </span>`;
              } else {
                  row.innerHTML = `<span>${o.label}</span>`;
              }

              if (o.disabled) {
                  row.classList.add("disabled");
                  row.style.opacity = "0.5";
                  row.style.cursor = "default";
              }

              row.onclick = (e) => {
                  e.stopPropagation();
                  if (o.disabled) return;

                  if (allowMultiple) {
                      o.checked = !o.checked;
                      onSelect(o.id, o.checked);
                      setTimeout(() => renderList(), 0);
                  } else {
                      onSelect(o.id);
                      closeMappingDropdown();
                  }
              };
              optionsBox.appendChild(row);
          });

          // 5. Inject the "Create New" button if search query has no exact match
          if (injectOnEmpty && q.length > 0) {
              const exactMatch = options.some(o => o.label.toLowerCase() === q);
              if (!exactMatch) {
                  const customButton = document.createElement("div");
                  customButton.className = "mapping-option custom-action";
                  customButton.style.color = "var(--accent)";
                  customButton.style.fontWeight = "600";
                  customButton.style.borderTop = "1px solid var(--line)";
                  customButton.textContent = injectOnEmpty.text.replace('{query}', q);
                  
                  customButton.onclick = (e) => {
                      e.stopPropagation();
                      injectOnEmpty.onClick(q);
                      closeMappingDropdown();
                  };
                  optionsBox.appendChild(customButton);
              }
          }

          if (optionsBox.children.length === 0) {
              optionsBox.innerHTML = `<div class="mapping-option muted" style="cursor:default;">No results found.</div>`;
          }
      }

      // 6. INITIALIZE EVENT LISTENERS
      dropdown.refresh = () => renderList();

      if (search) {
          search.oninput = () => renderList();
          // Focus the search box automatically
          setTimeout(() => search.focus(), 10);
      }

      function closeMappingDropdown() {
          document.removeEventListener("click", outside, true);
          dropdown.remove();
      }

      function outside(evt) {
          if (!dropdown.contains(evt.target) && evt.target !== anchorEl) {
              closeMappingDropdown();
          }
      }

      document.addEventListener("click", outside, true);

      // Initial Render
      renderList();
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
    // We now check if the click is outside the dropdown AND the trigger input
    const inDropdown = e.target.closest(".mapping-dropdown");
    const inTrigger = e.target.closest(".dp-select");
    if (inDropdown || inTrigger) return;

    // We rely on the global listener attached in openMappingDropdown to close itself.
    // We don't need a custom closeAllDatapointDropdowns here anymore, but keeping the name check for safety.
  });

  function handleRoute() {

    const hash = location.hash || "";

    const isDatapoints = hash.startsWith("#/settings/datapoints");
    const isCanonicalCaps = hash.startsWith(
      "#/settings/canonical-capabilities",
    );
    const isFunctions = hash.startsWith("#/functions");
    const isIntegrations = hash.startsWith("#/integrations");
    const isCapabilities = hash.startsWith("#/triggers-actions");
    const isTeam = hash.startsWith("#/settings/team");
    const isSegments = hash.startsWith("#/settings/segments");
    const isFolders = hash.startsWith("#/settings/folder-hierarchy");
    const isNaming = hash.startsWith("#/settings/naming-conventions");
    const isResources = hash.startsWith("#/resources");
    const isAnalyze = hash.startsWith("#/analyze");
    const isFeatures = hash.startsWith("#/settings/features");
    const isWorkflows = hash.startsWith("#/workflows");

    const showAppsSet =
      !isDatapoints &&
      !isFunctions &&
      !isIntegrations &&
      !isCanonicalCaps &&
      !isCapabilities &&
      !isTeam &&
      !isSegments &&
      !isFolders &&
      !isNaming &&
      !isResources &&
      !isAnalyze &&
      !isFeatures &&
      !isWorkflows;

    const showTeamSet = isTeam;

    const appsSection = document.getElementById("section-apps");
    const fnsSection = document.getElementById("section-functions");
    const intsSection = document.getElementById("section-integrations");
    const capsSection = document.getElementById("section-capabilities");
    const analyzeSection = document.getElementById("section-analyze");
    const dpsSection = document.getElementById("section-datapoints");
    const canonSection = document.getElementById("section-canonical-caps");
    const teamMembersSection = document.getElementById("section-team-members");
    const teamRolesSection = document.getElementById("section-team-roles");
    const unifiedSection = document.getElementById("section-unified-segments");
    const folderSection = document.getElementById("section-folder-hierarchy");
    const namingSection = document.getElementById("section-naming-conventions");
    const resourcesSection = document.getElementById("section-resources");
    const featuresSection = document.getElementById("section-features");
    const workflowsSection = document.getElementById("section-workflows");

    if (appsSection) appsSection.style.display = showAppsSet ? "block" : "none";
    if (fnsSection) fnsSection.style.display = isFunctions ? "block" : "none";
    if (featuresSection)
      featuresSection.style.display = isFeatures ? "block" : "none";
    if (intsSection) intsSection.style.display = isIntegrations ? "block" : "none";

    if (capsSection)
      capsSection.style.display = isCapabilities ? "block" : "none";
    if (dpsSection) dpsSection.style.display = isDatapoints ? "block" : "none";
    if (canonSection)
      canonSection.style.display = isCanonicalCaps ? "block" : "none";

    if (teamMembersSection)
      teamMembersSection.style.display = showTeamSet ? "block" : "none";
    if (teamRolesSection)
      teamRolesSection.style.display = showTeamSet ? "block" : "none";

    if (unifiedSection) {
        unifiedSection.style.display = isSegments ? "block" : "none";
    }

    if (folderSection)
      folderSection.style.display = isFolders ? "block" : "none";

    if (namingSection)
      namingSection.style.display = isNaming ? "block" : "none";

    if (resourcesSection)
      resourcesSection.style.display = isResources ? "block" : "none";

    if (workflowsSection)
      workflowsSection.style.display = isWorkflows ? "block" : "none";

    if (analyzeSection)
      analyzeSection.style.display = isAnalyze ? "block" : "none";
    if (isAnalyze) {
      OL.renderAnalysisLeftMenu();
      OL.renderAnalysisMatrix();
      // Since the matrix is empty on init, render it immediately
    }
    if (isFeatures) renderFeaturesGrid();
    if (isWorkflows) renderWorkflowsGrid();

    if (isSegments) {
        // 1. Activate the CSS reset
        document.body.classList.add("is-segments-page");
        
        // 2. Hide old sections and render the builder
        const oldSeg = document.getElementById("section-segments");
        const oldCat = document.getElementById("section-segment-categories");
        if (oldSeg) oldSeg.style.display = "none";
        if (oldCat) oldCat.style.display = "none";
        
        renderUnifiedSegmentBuilder();
    } else {
        // 3. Deactivate the reset so other pages scroll normally
        document.body.classList.remove("is-segments-page");
        
        // 4. Hide the builder
        const unifiedSection = document.getElementById("section-unified-segments");
        if (unifiedSection) unifiedSection.style.display = "none";
    }
  }
    window.addEventListener("hashchange", () => {
    localStorage.setItem("olLastPage", location.hash);
  });

  document.addEventListener("DOMContentLoaded", () => {
    const last = localStorage.getItem("olLastPage");
    if (last) location.hash = last;

    buildLayout();
    wireCapabilityViewToggle();
    migrateCanonicalFromLegacy();
    syncZapierIntegrationsFromCapabilities();

    OL.refreshAllUI();
    handleRoute();
  });

  window.addEventListener("hashchange", handleRoute);
})();

// ------------------------------------------------------------
// GLOBAL CLICK INTERCEPTOR
// ------------------------------------------------------------
document.addEventListener('click', function(e) {
    // 1. Check if the clicked element (or its parent) is our target
    const infoArea = e.target.closest('.process-info');
    
    if (infoArea) {
        // 2. Stop the browser from doing anything else (like starting a drag)
        e.preventDefault();
        e.stopPropagation();

        // 3. Get the ID from the parent row
        const row = infoArea.closest('.process-street-row');
        const workflowId = row ? row.getAttribute('data-workflow-id') : null;

        if (workflowId) {
            OL.openWorkflowVisualizer(workflowId);
        }
    }
}, true); // The "true" here is critical: it captures the event BEFORE others

window.handleOutcomeJump = function(type, workflowId, nodeId) {
    if (!nodeId && !workflowId) return;

    if (type === 'jump_step' && nodeId) {
        OL.closeModal();
        setTimeout(() => {
            // Re-open modal with the new step ID
            OL.openNodeModal(OL.activeWorkflowId, '', nodeId, 'step');
        }, 100);
    } else if (workflowId) {
        if (confirm("Navigate to the linked workflow?")) {
            OL.closeModal();
            OL.openWorkflowVisualizer(workflowId);
            if (nodeId) {
                setTimeout(() => OL.openNodeModal(workflowId, '', nodeId, 'step'), 300);
            }
        }
    }
};
