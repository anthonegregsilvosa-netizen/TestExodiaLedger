// === Mini QuickBooks Logic (COA + Journal + Ledger + Trial Balance) + AUTH (Login only) ===

// ==============================
// Local UI memory keys
// ==============================
const LAST_VIEW_KEY = "exodiaLedger.lastView.v1";
const LEDGER_ACCOUNT_KEY = "exodiaLedger.ledgerAccount.v1";
const JOURNAL_VIEW_KEY = "exodiaLedger.journalView.v1";
const FILTER_FROM_KEY = "exodiaLedger.filterFrom.v1";
const FILTER_TO_KEY = "exodiaLedger.filterTo.v1";
const WORKSHEET_VIEW_KEY = "exodiaLedger.worksheetView.v1";

// ==============================
// Supabase Setup
// ==============================
const SUPABASE_URL = "https://pezowkprqtawqzqxjtzb.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlem93a3BycXRhd3F6cXhqdHpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNzY5MDYsImV4cCI6MjA4NzY1MjkwNn0.OJuLSgh4_zTXpl5OWaEK9HdoFfnPF-TTx2rZCZN5rlQ";

// IMPORTANT: your index.html loads supabase-js first then app.js
if (!window.supabase) {
  alert("Supabase library not loaded. Check script tag order in index.html.");
}

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==============================
// DOM helper
// ==============================
const $ = (id) => document.getElementById(id);

// ==============================
// App state
// ==============================
let currentUser = null;
let COA = [];
let currentCOAType = "All";
let lines = []; // loaded from Supabase (journal_lines)

let currentView = "coa";

const viewFilters = {
  coa: { from: "", to: "" },
  ledger: { from: "", to: "" },
  trial: { from: "", to: "" },
  journal: { from: "", to: "" }
};

// ==============================
// AUTH UI helpers
// ==============================
function setUI(isLoggedIn, email = "") {
  const app = $("app");
  const outBox = $("auth-logged-out");
  const inBox = $("auth-logged-in");
  const userEl = $("auth-user");

  if (isLoggedIn) {
    if (app) app.style.display = "block";
    if (outBox) outBox.style.display = "none";
    if (inBox) inBox.style.display = "block";
    if (userEl) userEl.textContent = email || "";
  } else {
    if (app) app.style.display = "none";
    if (outBox) outBox.style.display = "block";
    if (inBox) inBox.style.display = "none";
    if (userEl) userEl.textContent = "";
  }
}

function setAuthMsg(text, isError = false) {
  const msg = $("auth-msg");
  if (!msg) return;
  msg.textContent = text || "";
  msg.style.color = isError ? "crimson" : "";
}

function setAuthMsgIn(text) {
  const msg = $("auth-msg-in");
  if (!msg) return;
  msg.textContent = text || "";
}

function clearAuthInputs() {
  const e = $("auth-email");
  const p = $("auth-pass");
  if (e) e.value = "";
  if (p) p.value = "";
}

function refreshLoginButtonState() {
  const btn = $("auth-login-btn");
  const email = ($("auth-email")?.value || "").trim();
  const pass = $("auth-pass")?.value || "";
  if (btn) btn.disabled = !(email && pass);
}

function initPasswordToggle() {
  const btn = $("auth-toggle-pass");
  const pass = $("auth-pass");
  if (!btn || !pass) return;

  btn.addEventListener("click", () => {
    pass.type = pass.type === "password" ? "text" : "password";
    btn.textContent = pass.type === "password" ? "👁" : "🙈";
  });
}

// ==============================
// AUTH actions
// ==============================
window.signIn = async function signIn() {
  const email = ($("auth-email")?.value || "").trim();
  const password = $("auth-pass")?.value || "";

  setAuthMsg("Logging in...");

  const { data, error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    clearAuthInputs();
    refreshLoginButtonState();
    setAuthMsg(error.message || "Login failed.", true);
    setUI(false);
    return;
  }

  currentUser = data.user;
  setAuthMsg("");
  setAuthMsgIn("Logged in ✅");
  setUI(true, currentUser?.email || email);

  await initAppAfterLogin();
};

window.signOut = async function signOut() {
  await sb.auth.signOut();

  clearAuthInputs();
  refreshLoginButtonState();

  currentUser = null;
  setAuthMsg("Logged out.");
  setAuthMsgIn("");
  setUI(false);
};

// ==============================
// Supabase helpers (JOURNAL LINES)
// ==============================
function normalizeLine(row) {
  const h = row.journal_entries || {};
  return {
    id: row.id,
    journal_id: row.journal_id || null,
    is_deleted: row.is_deleted ?? false,
    entry_date: row.entry_date,
    ref: row.ref,

    description: h.description || "",
    department: h.department || "",
    payment_method: h.payment_method || "",
    client_vendor: h.client_vendor || "",
    remarks: h.remarks || "",

    accountId: row.account_id,
    accountName: row.account_name || "",
    debit: Number(row.debit || 0),
    credit: Number(row.credit || 0),
    created_at: row.created_at,
  };
}

function normalizeEntry(row) {
  return {
    id: row.id,
    entry_date: row.entry_date,
    ref: row.ref,
    description: row.description || "",
    department: row.department || "",
    payment_method: row.payment_method || "",
    client_vendor: row.client_vendor || "",
    remarks: row.remarks || "",
    created_at: row.created_at,
  };
}

async function sbFetchJournalEntries() {
  if (!currentUser) return [];

  const { data, error } = await sb
    .from("journal_entries")
    .select("*")
    .eq("user_id", currentUser.id)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Entries fetch error:", error);
    return [];
  }

  return (data || []).map(normalizeEntry);
}

async function sbFetchJournalLines() {
  if (!currentUser) return [];

  const { data, error } = await sb
    .from("journal_lines")
    .select(`
      *,
      journal_entries:journal_id (
        description,
        department,
        payment_method,
        client_vendor,
        remarks
      )
    `)
    .eq("user_id", currentUser.id)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Journal fetch error:", error);
    return [];
  }

  return (data || []).map(normalizeLine);
}

async function sbFetchJournalLinesForEntry(journal_id) {
  if (!currentUser) return [];

  const { data, error } = await sb
    .from("journal_lines")
    .select("*")
    .eq("user_id", currentUser.id)
    .eq("journal_id", journal_id)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Lines fetch error:", error);
    return [];
  }

  return data || [];
}

async function sbInsertJournalLines(rows) {
  const { error } = await sb.from("journal_lines").insert(rows);
  if (error) throw error;
}

async function loadLinesFromDb() {
  try {
    return await sbFetchJournalLines();
  } catch (e) {
    console.error("loadLinesFromDb failed:", e);
    return [];
  }
}

async function sbFetchJournalEntryById(id) {
  if (!currentUser) return null;

  const { data, error } = await sb
    .from("journal_entries")
    .select("*")
    .eq("id", id)
    .eq("user_id", currentUser.id)
    .single();

  if (error) {
    console.error("Entry by ID fetch error:", error);
    return null;
  }

  return data;
}

async function sbFetchJournalLinesByJournalId(journal_id) {
  if (!currentUser) return [];

  const { data, error } = await sb
    .from("journal_lines")
    .select("*")
    .eq("journal_id", journal_id)
    .eq("user_id", currentUser.id)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Lines by journal_id fetch error:", error);
    return [];
  }

  return data || [];
}

// ==============================
// COA indexing + line account resolver
// ==============================
let COA_BY_ID = {};
let COA_BY_CODE = {};

function rebuildCoaIndex() {
  COA_BY_ID = {};
  COA_BY_CODE = {};
  (COA || []).forEach((a) => {
    const id = String(a.id || "").trim();
    const code = String(a.code || "").trim();
    if (id) COA_BY_ID[id] = a;
    if (code) COA_BY_CODE[code] = a;
  });
}

function parseCodeFromAccountName(accountName) {
  const t = String(accountName || "").trim();
  if (!t.includes(" - ")) return "";
  return String(t.split(" - ")[0] || "").trim();
}

function resolveAccountId(rawAccountId, accountName) {
  const raw = String(rawAccountId || "").trim();
  if (!raw) return "";

  // already an actual COA id
  if (COA_BY_ID[raw]) return raw;

  // if raw is a code (e.g. "1001")
  if (COA_BY_CODE[raw]?.id) return String(COA_BY_CODE[raw].id);

  // if raw looks like "1001 - Cash on Hand"
  const rawCode = parseCodeFromAccountName(raw);
  if (rawCode && COA_BY_CODE[rawCode]?.id) return String(COA_BY_CODE[rawCode].id);

  // fallback: try account_name column
  const code = parseCodeFromAccountName(accountName);
  if (code && COA_BY_CODE[code]?.id) return String(COA_BY_CODE[code].id);

  return raw;
}

function resolveLinesAccountIds() {
  rebuildCoaIndex();
  lines = (lines || []).map((l) => ({
    ...l,
    resolvedAccountId: resolveAccountId(l.accountId, l.accountName),
  }));
}

function makeAccountSelect() {
  const sel = document.createElement("select");

  const sorted = [...COA].sort((a, b) => codeNum(a.code) - codeNum(b.code));
  sorted.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = String(a.id); // IMPORTANT: UUID
    opt.textContent = `${a.code} - ${a.name}`;
    sel.appendChild(opt);
  });

  return sel;
}

function renderEditLines(linesForEdit) {
  const tbody = document.getElementById("edit-lines-body"); // <-- change to your edit page tbody id
  if (!tbody) return;

  tbody.innerHTML = "";

  linesForEdit.forEach((line) => {
    const tr = document.createElement("tr");

    const sel = makeAccountSelect();
    const resolvedId = resolveAccountId(line.account_id, line.account_name);

    // fallback option if account doesn't exist anymore
    if (![...sel.options].some((o) => o.value === resolvedId)) {
      const fallback = document.createElement("option");
      fallback.value = resolvedId || "";
      fallback.textContent = line.account_name || "(Unknown account)";
      sel.prepend(fallback);
    }

    sel.value = resolvedId;

    const tdAcct = document.createElement("td");
    tdAcct.appendChild(sel);
    tr.appendChild(tdAcct);

    tbody.appendChild(tr);
  });
}

// ==============================
// Supabase helpers (CHART OF ACCOUNTS)
// ==============================
function normalizeCOA(row) {
  return {
    id: row.id,
    code: row.code || "",
    name: row.name || "",
    type: row.type || "",
    normal: row.normal || "",
    is_deleted: row.is_deleted ?? false,
  };
}

async function sbFetchCOA() {
  if (!currentUser) return [];
  const { data, error } = await sb
    .from("coa_accounts")
    .select("*")
    .eq("user_id", currentUser.id)
    .eq("is_deleted", false)
    .order("code", { ascending: true });

  if (error) throw error;
  return (data || []).map(normalizeCOA);
}

async function sbInsertCOA(row) {
  const { data, error } = await sb
    .from("coa_accounts")
    .insert([row])
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function sbUpdateCOA(id, patch) {
  const { error } = await sb
    .from("coa_accounts")
    .update(patch)
    .eq("id", id)
    .eq("user_id", currentUser.id);
  if (error) throw error;
}

async function sbSoftDeleteCOA(id) {
  const { error } = await sb
    .from("coa_accounts")
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", currentUser.id);
  if (error) throw error;
}

// Upsert helper (used for importing JSON COA into DB without duplicates)
async function sbUpsertCOA(rows) {
  const { error } = await sb
    .from("coa_accounts")
    .upsert(rows, { onConflict: "user_id,code" });
  if (error) throw error;
}

// If DB has no COA yet (or is missing many), import/merge from JSON
async function seedCOAFromJsonIfNeeded() {
  let json = [];
  try {
    const raw = await fetch("./data/coa.json").then((r) => r.json());
    json = Array.isArray(raw) ? raw : [];
  } catch (e) {
    return; // no json
  }

  if (!json.length) return;

  let db = [];
  try {
    db = await sbFetchCOA();
  } catch (e) {
    console.warn("COA DB load failed (skip JSON import):", e);
    return;
  }

  const existingCodes = new Set(db.map((a) => String(a.code || "").trim()));
  const missing = json
    .map((r) => ({
      code: String(r.code || "").trim(),
      name: String(r.name || "").trim(),
      type: String(r.type || "").trim(),
      normal: String(r.normal || "").trim(),
    }))
    .filter((r) => r.code && r.name && !existingCodes.has(r.code));

  if (!missing.length) return;

  const rows = missing.map((r) => ({
    user_id: currentUser.id,
    code: r.code,
    name: r.name,
    type: r.type || "Asset",
    normal: r.normal || "Debit",
    is_deleted: false,
  }));

  try {
    await sbUpsertCOA(rows);
  } catch (e) {
    console.warn("COA JSON import failed:", e);
  }
}

async function loadCOAFromDbOrJson() {
  await seedCOAFromJsonIfNeeded();

  try {
    const dbCOA = await sbFetchCOA();
    if (dbCOA.length > 0) return dbCOA;
  } catch (e) {
    console.warn("COA DB load failed (will fallback to JSON):", e);
  }

  try {
    const json = await fetch("./data/coa.json").then((r) => r.json());
    const arr = Array.isArray(json) ? json : [];
    return arr.map((r) => ({
      id: r.id || r.code || crypto?.randomUUID?.() || String(Math.random()),
      code: r.code || "",
      name: r.name || "",
      type: r.type || "",
      normal: r.normal || "",
      is_deleted: false,
    }));
  } catch (e) {
    console.warn("COA JSON load failed:", e);
    return [];
  }
}

// ==============================
// Required-field helper (GLOBAL)
// ==============================
function markRequired(el, isBad) {
  if (!el) return;
  el.style.border = isBad ? "2px solid crimson" : "";
}

window.filterLedgerAccounts = function filterLedgerAccounts() {
  const sel = $("ledger-account");
  if (!sel) return;

  const q = ($("ledger-search")?.value || "").trim().toLowerCase();

  // rebuild dropdown every time based on search
  sel.innerHTML = "";

  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = q ? "Select from results..." : "Select account...";
  sel.appendChild(o0);

  const sorted = [...COA].sort((a, b) => {
    const ca = codeNum(a.code);
    const cb = codeNum(b.code);
    if (ca !== cb) return ca - cb;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  const filtered = q
    ? sorted.filter((a) => {
        const text = `${a.code} ${a.name} ${a.type}`.toLowerCase();
        return text.includes(q);
      })
    : sorted;

  filtered.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = `${a.code} - ${a.name}`;
    sel.appendChild(opt);
  });

  // keep previous selection if still visible
  const saved = localStorage.getItem(LEDGER_ACCOUNT_KEY) || "";
  if (saved && [...sel.options].some((o) => o.value === saved)) {
    sel.value = saved;
  }

  renderLedger();
};

// ==============================
// COA datalist (for searchable picker)
// ==============================
function refreshCoaDatalist() {
  const listId = "coa-datalist";
  let dl = document.getElementById(listId);

  if (!dl) {
    dl = document.createElement("datalist");
    dl.id = listId;
    document.body.appendChild(dl);
  }

  dl.innerHTML = "";

  const sorted = [...COA].sort((a, b) => {
    const ca = codeNum(a.code);
    const cb = codeNum(b.code);
    if (ca !== cb) return ca - cb;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  sorted.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = `${a.code} - ${a.name}`;
    dl.appendChild(opt);
  });
}

function textToAccountId(text) {
  const t = String(text || "").trim().toLowerCase();
  const found = COA.find((a) => (`${a.code} - ${a.name}`).toLowerCase() === t);
  return found ? found.id : "";
}

// ==============================
// Filters (Year/Month)
// ==============================
window.applyDateRangeFilter = function () {
  const from = $("filter-from")?.value || "";
  const to = $("filter-to")?.value || "";

  if (!viewFilters[currentView]) {
    viewFilters[currentView] = { from: "", to: "" };
  }

  viewFilters[currentView].from = from;
  viewFilters[currentView].to = to;

  if (currentView === "coa") renderCOA();
  if (currentView === "ledger") renderLedger();

  if (currentView === "trial") {
    const wsPL = $("ws-pl");
    const wsSFP = $("ws-sfp");

    if (wsPL && wsPL.style.display === "block") renderProfitAndLoss();
    else if (wsSFP && wsSFP.style.display === "block") renderStatementOfFinancialPosition();
    else renderTrialBalance();
  }

  if (currentView === "journal") {
    const journalMode = localStorage.getItem(JOURNAL_VIEW_KEY) || "entry";
    if (journalMode === "history") renderHistory();
  }
};

window.clearDateRange = function () {
  if (!viewFilters[currentView]) {
    viewFilters[currentView] = { from: "", to: "" };
  }

  viewFilters[currentView].from = "";
  viewFilters[currentView].to = "";

  if ($("filter-from")) $("filter-from").value = "";
  if ($("filter-to")) $("filter-to").value = "";

  if (currentView === "coa") renderCOA();
  if (currentView === "ledger") renderLedger();

  if (currentView === "trial") {
    const wsPL = $("ws-pl");
    const wsSFP = $("ws-sfp");

    if (wsPL && wsPL.style.display === "block") renderProfitAndLoss();
    else if (wsSFP && wsSFP.style.display === "block") renderStatementOfFinancialPosition();
    else renderTrialBalance();
  }

  if (currentView === "journal") {
    const journalMode = localStorage.getItem(JOURNAL_VIEW_KEY) || "history";
    if (journalMode === "history") renderHistory();
  }
};

// ==============================
// Journal sub-tabs (Entry / History)
// ==============================
window.showJournal = function (which) {
  localStorage.setItem(JOURNAL_VIEW_KEY, which);

  const entry = $("journal");
  const hist = $("journal-history");
  const dateBar = $("date-range-bar");

  if (entry) entry.style.display = (which === "entry") ? "block" : "none";
  if (hist) hist.style.display = (which === "history") ? "block" : "none";

  if (dateBar) dateBar.style.display = (which === "history") ? "flex" : "none";

  if (which === "entry") {
    const tbody = $("je-lines");
    if (tbody && tbody.children.length === 0) {
      addLine();
      addLine();
    }
  }

  if (which === "history") renderHistory();
};

window.showWorksheet = function (view) {
  localStorage.setItem(WORKSHEET_VIEW_KEY, view);

  const trial = $("ws-trial");
  const pl = $("ws-pl");
  const sfp = $("ws-sfp");

  if (trial) trial.style.display = (view === "trial") ? "block" : "none";
  if (pl) pl.style.display = (view === "pl") ? "block" : "none";
  if (sfp) sfp.style.display = (view === "sfp") ? "block" : "none";

  if (view === "trial") renderTrialBalance();
  if (view === "pl") renderProfitAndLoss();
  if (view === "sfp") renderStatementOfFinancialPosition();
};

// ==============================
// Tabs
// ==============================
window.show = function (view) {
  if (view === "journal-history") view = "journal";

  currentView = view;

  localStorage.setItem(LAST_VIEW_KEY, view);

  ["coa", "journal", "ledger", "trial"].forEach((v) => {
    const el = $(v);
    if (!el) return;
    el.style.display = v === view ? "block" : "none";
  });

  const hist = $("journal-history");
  if (hist) hist.style.display = "none";

  const coaTb = $("coa-toolbar");
  if (coaTb) coaTb.style.display = (view === "coa") ? "block" : "none";

  const journalTb = $("journal-toolbar");
  if (journalTb) journalTb.style.display = (view === "journal") ? "block" : "none";

  const dateBar = $("date-range-bar");
  const vf = viewFilters[view] || { from: "", to: "" };
  if ($("filter-from")) $("filter-from").value = vf.from || "";
  if ($("filter-to")) $("filter-to").value = vf.to || "";
  const journalMode = localStorage.getItem(JOURNAL_VIEW_KEY) || "entry";
  

  if (view === "journal" && journalMode === "entry") {
    if (dateBar) dateBar.style.display = "none";
  } else {
    if (dateBar) dateBar.style.display = "flex";
  }

  if (view === "coa") renderCOA();
  if (view === "ledger") renderLedger();

  if (view === "trial") {
  const savedWorksheetView = localStorage.getItem(WORKSHEET_VIEW_KEY) || "trial";
  showWorksheet(savedWorksheetView);
}

if (view === "journal") {
  const savedJournalView = localStorage.getItem(JOURNAL_VIEW_KEY) || "entry";
  showJournal(savedJournalView);
}
};

// ==============================
// COA buttons filter
// ==============================
window.filterCOA = function (type) {
  currentCOAType = type;
  renderCOA();
};

window.editAccountPrompt = async function editAccountPrompt(accountId) {
  if (!currentUser) return alert("Please login first.");
  const acct = COA.find((a) => a.id === accountId);
  if (!acct) return alert("Account not found.");

  const newName = (prompt(`Edit Account Name for ${acct.code} - ${acct.name}:`, acct.name) || "").trim();
  if (!newName) return;

  try {
    await sbUpdateCOA(accountId, { name: newName, updated_at: new Date().toISOString() });

    COA = await sbFetchCOA();
refreshCoaDatalist();
resolveLinesAccountIds();

const ledgerSel = $("ledger-account");
if (ledgerSel) ledgerSel.innerHTML = "";

renderCOA();
renderLedger();
renderTrialBalance();
    
    alert("✅ Account updated!");
  } catch (e) {
    console.error(e);
    alert("❌ Failed to update. Check policies.");
  }
};

// ==============================
// Add Account (from your COA form in HTML)
// ==============================
window.addCOAAccount = async function addCOAAccount() {
  if (!currentUser) return alert("Please login first.");

  const codeEl = $("coa-code");
  const nameEl = $("coa-name");
  const typeEl = $("coa-type");
  const normalEl = $("coa-normal");

  const code = (codeEl?.value || "").trim();
  const name = (nameEl?.value || "").trim();
  const type = (typeEl?.value || "").trim();
  const normal = (normalEl?.value || "").trim();

  markRequired(codeEl, !code);
  markRequired(nameEl, !name);

  if (!code || !name) return;

  try {
    await sbInsertCOA({
      user_id: currentUser.id,
      code,
      name,
      type,
      normal,
      is_deleted: false,
    });

    if (codeEl) codeEl.value = "";
    if (nameEl) nameEl.value = "";

    COA = await sbFetchCOA();
    refreshCoaDatalist();
    resolveLinesAccountIds();

    const ledgerSel = $("ledger-account");
    if (ledgerSel) ledgerSel.innerHTML = "";

    renderCOA();
    renderLedger();
    renderTrialBalance();

    alert("✅ Account added!");
  } catch (e) {
    console.error(e);
    alert("❌ Failed to add account (maybe duplicate code).");
  }
};

// ==============================
// Journal Entry
// ==============================
window.addLine = function () {
  const tbody = $("je-lines");
  if (!tbody) return;

  const tr = document.createElement("tr");

  const wrap = document.createElement("div");
  wrap.style.display = "grid";
  wrap.style.gap = "6px";

  const acctInput = document.createElement("input");
  acctInput.placeholder = "Type to search account (code or name)...";
  acctInput.style.width = "100%";
  acctInput.setAttribute("list", "coa-datalist");

  const acctId = document.createElement("input");
  acctId.type = "hidden";

  acctInput.addEventListener("input", () => {
    acctId.value = textToAccountId(acctInput.value);
  });

  wrap.appendChild(acctInput);
  wrap.appendChild(acctId);

  const debit = document.createElement("input");
  debit.placeholder = "0.00";
  debit.style.width = "100%";

  const credit = document.createElement("input");
  credit.placeholder = "0.00";
  credit.style.width = "100%";

  const delBtn = document.createElement("button");
delBtn.textContent = "Remove";
delBtn.className = "btn-soft";
delBtn.style.fontSize = "14px";
delBtn.style.padding = "8px 12px";
delBtn.onclick = () => tr.remove();

  tr.appendChild(tdWrap(wrap));
  tr.appendChild(tdWrap(debit, true));
  tr.appendChild(tdWrap(credit, true));
  tr.appendChild(tdWrap(delBtn, true));

  tbody.appendChild(tr);
};

window.saveJournal = async function () {
  if (!currentUser) return setStatus("Please login first.");

  const entry_date = $("je-date")?.value || "";
  const ref = ($("je-refno")?.value || "").trim();
  const description = ($("je-description")?.value || "").trim();

  markRequired($("je-date"), !entry_date);
  markRequired($("je-refno"), !ref);
  markRequired($("je-description"), !description);

  if (!entry_date || !ref || !description) {
    setStatus("Please fill all required (*) fields before saving.");
    return;
  }

  const department = ($("je-dept")?.value || "").trim();
  const payment_method = ($("je-paymethod")?.value || "").trim();
  const client_vendor = ($("je-client")?.value || "").trim();
  const remarks = ($("je-remarks")?.value || "").trim();

  const rows = [...$("je-lines").querySelectorAll("tr")];
  const lineRows = [];

  let totalDebit = 0;
  let totalCredit = 0;

  rows.forEach((r) => {
    const hidden = r.querySelector('input[type="hidden"]');
    const tds = r.querySelectorAll("td");

    const accountId = hidden?.value || "";
    const debitInput = tds[1]?.querySelector("input");
    const creditInput = tds[2]?.querySelector("input");

    const d = parseMoney(debitInput?.value);
    const c = parseMoney(creditInput?.value);

    if (!accountId) return;
    if (!d && !c) return;

    const acct = COA.find((a) => a.id === accountId);
    const accountName = acct ? `${acct.code} - ${acct.name}` : "";

    totalDebit += d;
    totalCredit += c;

   lineRows.push({
  user_id: currentUser.id,
  journal_id: null,
  entry_date,
  ref,
  account_id: accountId,
  account_name: accountName,
  debit: d,
  credit: c,
});
});

  if (lineRows.length < 2) return setStatus("Add at least 2 lines.");
  if (Math.abs(totalDebit - totalCredit) > 0.00001) {
    setStatus("❌ Journal Entry is not balanced. Please match Debit and Credit.");
    return;
  }

  const { data: entry, error: entryErr } = await sb
    .from("journal_entries")
    .insert([
      {
        user_id: currentUser.id,
        entry_date,
        ref,
        description,
        department,
        payment_method,
        client_vendor,
        remarks,
      },
    ])
    .select("id")
    .single();

  if (entryErr) {
    if (entryErr.code === "23505") {
      return setStatus("Save failed ❌ Ref No already exists. Use a new Ref No.");
    }
    console.error(entryErr);
    return setStatus("Save failed ❌ Policy/table error.");
  }

  const journal_id = entry.id;
  const finalLines = lineRows.map((r) => ({ ...r, journal_id }));

  try {
    await sbInsertJournalLines(finalLines);

    lines = await loadLinesFromDb();
    resolveLinesAccountIds();

    // keep the selected date, clear the other fields
if ($("je-refno")) $("je-refno").value = "";
if ($("je-description")) $("je-description").value = "";
if ($("je-dept")) $("je-dept").value = "";
if ($("je-paymethod")) $("je-paymethod").value = "";
if ($("je-client")) $("je-client").value = "";
if ($("je-remarks")) $("je-remarks").value = "";

// clear journal lines and give 2 fresh rows
$("je-lines").innerHTML = "";
addLine();
addLine();

// remove red borders after successful save
markRequired($("je-refno"), false);
markRequired($("je-description"), false);
markRequired($("je-date"), false);

setStatus("Saved ✅ General Ledger updated automatically.");
renderCOA();
renderLedger();
renderTrialBalance();
  } catch (e) {
    console.error(e);
    setStatus("Save failed ❌ Check console + Supabase policies.");
  }
};

// ==============================
// Render COA  ✅ FIXED (no nested forEach, no missing braces)
// ==============================
function renderCOA() {
  const tbody = $("coa-body");
  if (!tbody) return;

  tbody.innerHTML = "";
 const balances = computeBalances(
  viewFilters.coa?.from || "",
  viewFilters.coa?.to || ""
);

  const totalsByType = {
    Asset: 0,
    Liability: 0,
    Equity: 0,
    Revenue: 0,
    Expense: 0,
  };

  COA.forEach((a) => {
    const bal = balances[a.id] || 0;
    if (totalsByType[a.type] !== undefined) {
      totalsByType[a.type] += bal;
    }
  });

  if ($("sum-asset")) $("sum-asset").textContent = money(totalsByType.Asset || 0);
  if ($("sum-liability")) $("sum-liability").textContent = money(totalsByType.Liability || 0);
  if ($("sum-equity")) $("sum-equity").textContent = money(totalsByType.Equity || 0);
  if ($("sum-revenue")) $("sum-revenue").textContent = money(totalsByType.Revenue || 0);
  if ($("sum-expense")) $("sum-expense").textContent = money(totalsByType.Expense || 0);

  const typeOrder = { Asset: 1, Liability: 2, Equity: 3, Revenue: 4, Expense: 5 };

  const list = COA
    .filter((a) => currentCOAType === "All" || a.type === currentCOAType)
    .sort((a, b) => {
      const ta = typeOrder[a.type] ?? 99;
      const tb = typeOrder[b.type] ?? 99;
      if (ta !== tb) return ta - tb;

      const ca = codeNum(a.code);
      const cb = codeNum(b.code);
      if (ca !== cb) return ca - cb;

      return String(a.name || "").localeCompare(String(b.name || ""));
    });

  list.forEach((a) => {
    const bal = balances[a.id] || 0;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(a.code)}</td>
      <td>${esc(a.name)}</td>
      <td>${esc(a.type)}</td>
      <td>${esc(a.normal)}</td>
      <td style="text-align:right;">${money(bal)}</td>
      <td style="position:relative; text-align:right;">
        <button class="coa-action-btn" onclick="toggleCoaMenu('${a.id}', event)">⋯</button>
        <div class="coa-menu" data-coa-menu="${a.id}">
          <button onclick="editAccountPrompt('${a.id}')">✏️ Edit name</button>
          <button class="danger" onclick="deleteCOAAccount('${a.id}')">🗑 Delete</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (list.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6">No accounts found for this filter.</td>`;
    tbody.appendChild(tr);
  }
}

// ==============================
// Render Ledger
// ==============================
function renderLedger() {
  const sel = $("ledger-account");
  const tbody = $("ledger-body");
  if (!sel || !tbody) return;

  if (sel.options.length === 0) {
    sel.innerHTML = "";

    const o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = "Select account...";
    sel.appendChild(o0);

    const sorted = [...COA].sort((a, b) => {
      const ca = codeNum(a.code);
      const cb = codeNum(b.code);
      if (ca !== cb) return ca - cb;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    sorted.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = `${a.code} - ${a.name}`;
      sel.appendChild(opt);
    });

    const savedAcct = localStorage.getItem(LEDGER_ACCOUNT_KEY) || "";
    if (savedAcct) {
      if (!COA_BY_ID[savedAcct] && COA_BY_CODE[savedAcct]?.id) {
        sel.value = String(COA_BY_CODE[savedAcct].id);
      } else {
        sel.value = savedAcct;
      }
    }
  }

  tbody.innerHTML = "";
  const accountId = sel.value;
  localStorage.setItem(LEDGER_ACCOUNT_KEY, accountId || "");
  if (!accountId) return;

  const acct = COA.find((a) => a.id === accountId);
  const normal = acct?.normal || "Debit";

  const acctLines = lines
    .filter((l) => !l.is_deleted)
    .filter((l) => (l.resolvedAccountId || l.accountId) === accountId)
    .filter((l) => {
  const from = viewFilters.ledger?.from || "";
  const to = viewFilters.ledger?.to || "";
  const d = String(l.entry_date || "");
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
})
    .sort(
      (a, b) =>
        String(a.entry_date || "").localeCompare(String(b.entry_date || "")) ||
        String(a.ref || "").localeCompare(String(b.ref || ""))
    );

  let running = 0;

  acctLines.forEach((l) => {
    const delta =
      normal === "Credit"
        ? num(l.credit) - num(l.debit)
        : num(l.debit) - num(l.credit);

    running += delta;

    const tr = document.createElement("tr");
    const canEdit = !!l.journal_id;

   tr.innerHTML = `
  <td>${esc(l.entry_date)}</td>
  <td>${esc(l.ref)}</td>
  <td>${esc(l.description || "")}</td>
  <td>${esc(l.department || "")}</td>
  <td>${esc(l.payment_method || "")}</td>
  <td>${esc(l.client_vendor || "")}</td>
  <td>${esc(l.remarks || "")}</td>
  <td style="text-align:right;">${money(l.debit)}</td>
  <td style="text-align:right;">${money(l.credit)}</td>
  <td style="text-align:right;">${money(running)}</td>
  <td>
    ${
      canEdit
        ? `<a href="./edit.html?journal_id=${encodeURIComponent(
            l.journal_id
          )}&account_id=${encodeURIComponent(accountId)}">Edit / Delete</a>`
        : `<span class="muted">N/A</span>`
    }
  </td>
`;

    tbody.appendChild(tr);
  });

  if (acctLines.length === 0) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td colspan="11" style="text-align:center; padding:20px;">
      No transactions for this account (with current filter).
    </td>
  `;
  tbody.appendChild(tr);
}
}

// ==============================
// Compute balances
// ==============================
function computeBalances(from = "", to = "") {
  const normals = Object.fromEntries(COA.map((a) => [a.id, a.normal]));
  const balances = {};

  lines
    .filter((l) => !l.is_deleted)
    .filter((l) => {
      const d = String(l.entry_date || "");
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    })
    .forEach((l) => {
      const key = l.resolvedAccountId || l.accountId;
      const normal = normals[key] || "Debit";
      const delta =
        normal === "Credit"
          ? num(l.credit) - num(l.debit)
          : num(l.debit) - num(l.credit);

      balances[key] = (balances[key] || 0) + delta;
    });

  return balances;
}

// ==============================
// Trial Balance
// ==============================

function renderTrialBalance() {
  const tbody = $("tb-body");
  const tdTotal = $("tb-total-debit");
  const tcTotal = $("tb-total-credit");
  const status = $("tb-status");

  if (!tbody || !tdTotal || !tcTotal) return;

  tbody.innerHTML = "";
  if (status) status.textContent = "";

  const balances = computeBalances(
  viewFilters.trial?.from || "",
  viewFilters.trial?.to || ""
);

  const typeOrder = { Asset: 1, Liability: 2, Equity: 3, Revenue: 4, Expense: 5 };

  const list = [...COA].sort((a, b) => {
    const ta = typeOrder[a.type] ?? 99;
    const tb = typeOrder[b.type] ?? 99;
    if (ta !== tb) return ta - tb;

    const ca = codeNum(a.code);
    const cb = codeNum(b.code);
    if (ca !== cb) return ca - cb;

    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  let totalDebit = 0;
  let totalCredit = 0;

  list.forEach((a) => {
    const bal = balances[a.id] || 0;

    let debit = 0;
    let credit = 0;

    if (a.normal === "Debit") {
      debit = Math.max(bal, 0);
      credit = Math.max(-bal, 0);
    } else {
      credit = Math.max(bal, 0);
      debit = Math.max(-bal, 0);
    }

    totalDebit += debit;
    totalCredit += credit;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(a.code)}</td>
      <td>${esc(a.name)}</td>
      <td>${esc(a.type)}</td>
      <td style="text-align:right;">${money(debit)}</td>
      <td style="text-align:right;">${money(credit)}</td>
    `;
    tbody.appendChild(tr);
  });

  tdTotal.textContent = money(totalDebit);
  tcTotal.textContent = money(totalCredit);

  const diff = Math.abs(totalDebit - totalCredit);
  if (status) {
    status.textContent =
      diff < 0.00001 ? "Balanced ✅" : `Not balanced ❌ (Difference: ${money(diff)})`;
  }
}

function renderProfitAndLoss() {
  const tbody = $("pl-body");
  const netEl = $("pl-net");
  if (!tbody || !netEl) return;

  tbody.innerHTML = "";

const from = viewFilters.trial?.from || "";
const to = viewFilters.trial?.to || "";

const filteredLines = lines
  .filter((l) => !l.is_deleted)
  .filter((l) => {
    const d = String(l.entry_date || "");
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });

  // -----------------------------
  // REVENUE
  // -----------------------------
  const revenueAccounts = COA
    .filter((a) => String(a.type || "").trim() === "Revenue")
    .sort((a, b) => {
      const ca = codeNum(a.code);
      const cb = codeNum(b.code);
      if (ca !== cb) return ca - cb;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

  let totalRevenue = 0;

  const revHead = document.createElement("tr");
  revHead.innerHTML = `<td colspan="2"><b>Revenue</b></td>`;
  tbody.appendChild(revHead);

  revenueAccounts.forEach((acct) => {
    const acctId = acct.id;
    const total = filteredLines
      .filter((l) => (l.resolvedAccountId || l.accountId) === acctId)
      .reduce((sum, l) => sum + (num(l.credit) - num(l.debit)), 0);

    totalRevenue += total;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(acct.name)}</td>
      <td style="text-align:right;">${money(Math.abs(total) < 0.00001 ? 0 : total)}</td>
    `;
    tbody.appendChild(tr);
  });

  const revTotal = document.createElement("tr");
  revTotal.innerHTML = `
    <td><b>Total Revenue</b></td>
    <td style="text-align:right;"><b>${money(Math.abs(totalRevenue) < 0.00001 ? 0 : totalRevenue)}</b></td>
  `;
  tbody.appendChild(revTotal);

  // -----------------------------
  // EXPENSES
  // -----------------------------
  const expenseAccounts = COA
    .filter((a) => {
      const t = String(a.type || "").trim();
      return t === "Expense" || t === "Expenses";
    });

  const departmentGroups = {};
  const companyItems = [];

  expenseAccounts.forEach((acct) => {
    const rawName = String(acct.name || "").trim();
    const acctId = acct.id;

    const acctTotal = filteredLines
      .filter((l) => (l.resolvedAccountId || l.accountId) === acctId)
      .reduce((sum, l) => sum + (num(l.debit) - num(l.credit)), 0);

    if (isDepartmentExpenseName(rawName)) {
      const groupName = getDepartmentExpenseGroupName(rawName);

      if (!departmentGroups[groupName]) {
        departmentGroups[groupName] = {
          total: 0,
          items: []
        };
      }

      departmentGroups[groupName].total += acctTotal;
      departmentGroups[groupName].items.push({
  name: rawName,
  departmentLabel: getDepartmentLabelFromAccountName(rawName),
  total: acctTotal
});
    } else {
      companyItems.push({
        name: rawName,
        total: acctTotal,
        code: acct.code || ""
      });
    }
  });

  let totalExpense = 0;

  const expHead = document.createElement("tr");
  expHead.innerHTML = `<td colspan="2"><b>Expenses</b></td>`;
  tbody.appendChild(expHead);

  // -----------------------------
  // DEPARTMENT EXPENSE GROUPS FIRST
  // -----------------------------
  const orderedDepartmentGroups = Object.keys(departmentGroups).sort((a, b) => {
    return getDepartmentExpenseGroupOrder(a) - getDepartmentExpenseGroupOrder(b);
  });

  orderedDepartmentGroups.forEach((groupName, i) => {
    const grp = departmentGroups[groupName];
    totalExpense += grp.total;

    const detailClass = `pl-dept-${i}`;

   const parentRow = document.createElement("tr");
parentRow.innerHTML = `
  <td>
    <button type="button" class="btn-soft" onclick="togglePLDetail('${detailClass}', this)">▶</button>
    <b>${esc(groupName)}</b>
  </td>
  <td style="text-align:right;"><b>${money(Math.abs(grp.total) < 0.00001 ? 0 : grp.total)}</b></td>
`;
tbody.appendChild(parentRow);

grp.items
  .sort((a, b) => {
    return a.departmentLabel.localeCompare(b.departmentLabel);
  })
  .forEach((item) => {
    const dtr = document.createElement("tr");
    dtr.className = detailClass;
    dtr.style.display = "none";
    dtr.innerHTML = `
      <td style="padding-left:40px;">${esc(item.departmentLabel)}</td>
      <td style="text-align:right;">${money(Math.abs(item.total) < 0.00001 ? 0 : item.total)}</td>
    `;
    tbody.appendChild(dtr);
  });
  });

  // -----------------------------
  // COMPANY EXPENSES AFTER DEPARTMENT EXPENSES
  // -----------------------------
  if (companyItems.length > 0) {
    const companyHead = document.createElement("tr");
    companyHead.innerHTML = `<td colspan="2"><b>Company Expenses</b></td>`;
    tbody.appendChild(companyHead);

    companyItems
      .sort((a, b) => {
        const oa = getCompanyExpenseOrder(a.name);
        const ob = getCompanyExpenseOrder(b.name);
        if (oa !== ob) return oa - ob;
        return a.name.localeCompare(b.name);
      })
      .forEach((item) => {
        totalExpense += item.total;

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${esc(item.name)}</td>
          <td style="text-align:right;">${money(Math.abs(item.total) < 0.00001 ? 0 : item.total)}</td>
        `;
        tbody.appendChild(tr);
      });
  }

  const expTotal = document.createElement("tr");
  expTotal.innerHTML = `
    <td><b>Total Expenses</b></td>
    <td style="text-align:right;"><b>${money(Math.abs(totalExpense) < 0.00001 ? 0 : totalExpense)}</b></td>
  `;
  tbody.appendChild(expTotal);

  const net = totalRevenue - totalExpense;
  netEl.textContent = money(Math.abs(net) < 0.00001 ? 0 : net);
}

function renderStatementOfFinancialPosition() {
  const tbody = $("sfp-body");
  if (!tbody) return;

  tbody.innerHTML = "";

  const balances = computeBalances(
  viewFilters.trial?.from || "",
  viewFilters.trial?.to || ""
);

  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;

  COA.forEach((a) => {
    const bal = balances[a.id] || 0;
    const type = String(a.type || "").trim();

    if (type === "Asset" || type === "Assets") totalAssets += bal;
    if (type === "Liability" || type === "Liabilities") totalLiabilities += bal;
    if (type === "Equity") totalEquity += bal;
  });

  tbody.innerHTML = `
    <tr>
      <td><b>Total Assets</b></td>
      <td style="text-align:right;">${money(totalAssets)}</td>
    </tr>
    <tr>
      <td><b>Total Liabilities</b></td>
      <td style="text-align:right;">${money(totalLiabilities)}</td>
    </tr>
    <tr>
      <td><b>Total Equity</b></td>
      <td style="text-align:right;">${money(totalEquity)}</td>
    </tr>
    <tr>
      <td><b>Total Liabilities and Equity</b></td>
      <td style="text-align:right;">${money(totalLiabilities + totalEquity)}</td>
    </tr>
  `;
}

window.downloadTrialBalancePDF = function downloadTrialBalancePDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("PDF library not loaded.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const title = "Trial Balance";
  const from = filterFrom || "";
  const to = filterTo || "";

  let subtitle = "All transactions";
  if (from && to) subtitle = `Date Range: ${from} to ${to}`;
  else if (from) subtitle = `From: ${from}`;
  else if (to) subtitle = `To: ${to}`;

  doc.setFontSize(16);
  doc.text(title, 14, 18);

  doc.setFontSize(10);
  doc.text(subtitle, 14, 25);

  const balances = computeBalances();

  const typeOrder = { Asset: 1, Liability: 2, Equity: 3, Revenue: 4, Expense: 5 };

  const list = [...COA].sort((a, b) => {
    const ta = typeOrder[a.type] ?? 99;
    const tb = typeOrder[b.type] ?? 99;
    if (ta !== tb) return ta - tb;

    const ca = codeNum(a.code);
    const cb = codeNum(b.code);
    if (ca !== cb) return ca - cb;

    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  let totalDebit = 0;
  let totalCredit = 0;

  const rows = list.map((a) => {
    const bal = balances[a.id] || 0;

    let debit = 0;
    let credit = 0;

    if (a.normal === "Debit") {
      debit = Math.max(bal, 0);
      credit = Math.max(-bal, 0);
    } else {
      credit = Math.max(bal, 0);
      debit = Math.max(-bal, 0);
    }

    totalDebit += debit;
    totalCredit += credit;

    return [
      a.code || "",
      a.name || "",
      a.type || "",
      money(debit),
      money(credit),
    ];
  });

  doc.autoTable({
    startY: 30,
    head: [["Code", "Account Name", "Type", "Debit", "Credit"]],
    body: rows,
    foot: [[
      "",
      "",
      "Total",
      money(totalDebit),
      money(totalCredit)
    ]],
    styles: {
      fontSize: 9,
      cellPadding: 3,
    },
    headStyles: {
      fillColor: [51, 51, 51],
    },
    footStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontStyle: "bold",
    },
    columnStyles: {
      3: { halign: "right" },
      4: { halign: "right" },
    },
  });

  const diff = Math.abs(totalDebit - totalCredit);
  const status = diff < 0.00001
    ? "Balanced"
    : `Not balanced (Difference: ${money(diff)})`;

  const finalY = doc.lastAutoTable.finalY || 30;
  doc.setFontSize(10);
  doc.text(`Status: ${status}`, 14, finalY + 10);

  doc.save("trial-balance.pdf");
};

// ==============================
// Init after login
// ==============================
async function initAppAfterLogin() {
  const d = new Date();
  if ($("je-date")) $("je-date").valueAsDate = d;

  COA = await loadCOAFromDbOrJson();
  refreshCoaDatalist();

  lines = await loadLinesFromDb();
  resolveLinesAccountIds();

  const ledgerSel = $("ledger-account");
  if (ledgerSel) ledgerSel.innerHTML = "";

  // restore saved date range
const savedFrom = localStorage.getItem(FILTER_FROM_KEY) || "";
const savedTo = localStorage.getItem(FILTER_TO_KEY) || "";

filterFrom = savedFrom;
filterTo = savedTo;

if ($("filter-from")) $("filter-from").value = savedFrom;
if ($("filter-to")) $("filter-to").value = savedTo;

  applyDateRangeFilter();

const lastView = localStorage.getItem(LAST_VIEW_KEY) || "coa";
const acctFromUrl = getQueryParam("account_id");
const savedLedgerAccount = localStorage.getItem(LEDGER_ACCOUNT_KEY) || "";

// if coming back from edit page, go to ledger
if (window.location.hash === "#ledger" || acctFromUrl) {
  show("ledger");

  if ($("ledger-account")) {
    $("ledger-account").value = acctFromUrl || savedLedgerAccount || "";
  }

  renderLedger();

  // clean the URL so next refresh uses saved page normally
  window.history.replaceState({}, document.title, window.location.pathname);
} else {
  show(lastView);

  if (lastView === "ledger" && $("ledger-account")) {
    $("ledger-account").value = savedLedgerAccount || "";
    renderLedger();
  }
}
  
} // ✅ THIS closes initAppAfterLogin()

// ==============================
// Render Journal History ✅
// ==============================
function renderHistory() {
  const tbody = $("history-body");
  const status = $("history-status");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (status) status.textContent = "Loading...";

  if (!currentUser) {
    if (status) status.textContent = "Please login first.";
    return;
  }

  sbFetchJournalEntries()
    .then((entries) => {
      tbody.innerHTML = "";

      if (!entries || entries.length === 0) {
        if (status) status.textContent = "No journal entries found.";
        return;
      }

      if (status) status.textContent = "";

      entries.forEach((e) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
  <td>${esc(e.entry_date || "")}</td>
  <td>${esc(formatDateTime(e.created_at))}</td>
  <td>${esc(e.ref || "")}</td>
  <td>${esc(e.description || "")}</td>
  <td>${esc(e.department || "")}</td>
  <td>${esc(e.payment_method || "")}</td>
  <td>${esc(e.client_vendor || "")}</td>
  <td>${esc(e.remarks || "")}</td>
  <td>
    <button class="btn" onclick="viewHistoryEntry('${e.id}')">View</button>
  </td>
`;
        tbody.appendChild(tr);
      });
    })
    .catch((err) => {
      console.error("renderHistory error:", err);
      if (status) status.textContent = "Failed to load history.";
    });
}

// helper: format created_at into readable time
function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

window.closeHistoryModal = function closeHistoryModal() {
  const m = $("history-modal");
  if (m) m.style.display = "none";
};

window.viewHistoryEntry = async function viewHistoryEntry(journal_id) {
  if (!currentUser) return alert("Please login first.");

  const modal = $("history-modal");
  const linesBody = $("hm-lines");
  if (!modal || !linesBody) return alert("History modal not found in HTML.");

  // fetch header
  const { data: entry, error } = await sb
    .from("journal_entries")
    .select("*")
    .eq("id", journal_id)
    .eq("user_id", currentUser.id)
    .single();

  if (error) {
    console.error(error);
    alert("Failed to load journal entry.");
    return;
  }

  // fill header
  $("hm-date").textContent = entry.entry_date || "";
  $("hm-ref").textContent = entry.ref || "";
  $("hm-desc").textContent = entry.description || "";
  $("hm-dept").textContent = entry.department || "";
  $("hm-pay").textContent = entry.payment_method || "";
  $("hm-client").textContent = entry.client_vendor || "";
  $("hm-remarks").textContent = entry.remarks || "";

  // fetch lines
  const jLines = await sbFetchJournalLinesForEntry(journal_id);

  // render lines
  linesBody.innerHTML = "";
  let firstAccountId = "";

  jLines.forEach((l) => {
    if (!firstAccountId) firstAccountId = l.account_id || "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(l.account_name || "")}</td>
      <td style="text-align:right;">${money(l.debit || 0)}</td>
      <td style="text-align:right;">${money(l.credit || 0)}</td>
    `;
    linesBody.appendChild(tr);
  });

  if (jLines.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3" style="text-align:center; padding:10px;">No lines found.</td>`;
    linesBody.appendChild(tr);
  }

  // wire Edit/Delete button
  const btn = $("hm-edit-btn");
  if (btn) {
    btn.onclick = () => {
      const acct = encodeURIComponent(firstAccountId || "");
      window.location.href = `./edit.html?journal_id=${encodeURIComponent(journal_id)}&account_id=${acct}`;
    };
  }

  modal.style.display = "grid";
};

// ==============================
// Restore session on refresh
// ==============================
(async function restoreSession() {
  initPasswordToggle();

  $("auth-email")?.addEventListener("input", refreshLoginButtonState);
  $("auth-pass")?.addEventListener("input", refreshLoginButtonState);
  refreshLoginButtonState();

  const { data } = await sb.auth.getSession();
  const session = data.session;

  if (session?.user) {
    currentUser = session.user;
    setUI(true, currentUser.email);
    await initAppAfterLogin();
  } else {
    setUI(false);
  }

  const isEditPage = window.location.pathname.endsWith("edit.html");
if (isEditPage) {
  const journal_id = getQueryParam("journal_id");
  if (!journal_id) {
    alert("Missing journal_id in URL.");
    return;
  }

  // load COA so dropdown has options
  COA = await loadCOAFromDbOrJson();
  rebuildCoaIndex();

  // fetch header + lines
  const entry = await sbFetchJournalEntryById(journal_id);
  const jLines = await sbFetchJournalLinesByJournalId(journal_id);

  // optional: show header fields if edit.html has these ids
  // (safe even if not present)
  $("edit-date") && ( $("edit-date").value = entry?.entry_date || "" );
  $("edit-ref") && ( $("edit-ref").value = entry?.ref || "" );
  $("edit-desc") && ( $("edit-desc").value = entry?.description || "" );

  // IMPORTANT: this must match your edit.html tbody id
  // Your renderEditLines currently uses: "edit-lines-body"
  renderEditLines(jLines);
}
  
})();

// ==============================
// Helpers / Utils
// ==============================

function getQueryParam(name) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name) || "";
}
  
function tdWrap(el, right = false) {
  const td = document.createElement("td");
  if (right) td.style.textAlign = "right";
  td.appendChild(el);
  return td;
}

function setStatus(msg) {
  const el = $("je-status");
  if (el) el.textContent = msg;
}

function codeNum(code) {
  const n = Number(String(code || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? n : 999999999;
}

function parseMoney(v) {
  const cleaned = String(v || "").replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function num(v) {
  return Number(v) || 0;
}

function money(n) {
  return (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isDepartmentExpenseName(name) {
  const n = String(name || "").trim();

  if (
    n === "Facilities Department Expense - General" ||
    n === "Finance Department Expense - General" ||
    n === "Human Resource Department Expense - General" ||
    n === "Information Technology Department Expense - General" ||
    n === "Marketing Department Expense - General" ||
    n === "Operation Department Expense - General" ||
    n === "Sales Department Expense - General" ||
    n === "Chiefs Expense - General"
  ) {
    return true;
  }

  const prefixes = [
    "FE - ",
    "Fine - ",
    "HRE - ",
    "ITE - ",
    "ME - ",
    "OpEx - ",
    "SE - ",
    "ChiE - "
  ];

  if (prefixes.some((p) => n.startsWith(p))) return true;
  if (n === "ChiE_Office_Equipment_Expense") return true;

  return false;
}

function getDepartmentExpenseGroupName(name) {
  const n = String(name || "").trim();

  if (
    n === "Facilities Department Expense - General" ||
    n === "Finance Department Expense - General" ||
    n === "Human Resource Department Expense - General" ||
    n === "Information Technology Department Expense - General" ||
    n === "Marketing Department Expense - General" ||
    n === "Operation Department Expense - General" ||
    n === "Sales Department Expense - General" ||
    n === "Chiefs Expense - General"
  ) {
    return "General";
  }

  const prefixMap = [
    "FE - ",
    "Fine - ",
    "HRE - ",
    "ITE - ",
    "ME - ",
    "OpEx - ",
    "SE - ",
    "ChiE - "
  ];

  for (const prefix of prefixMap) {
    if (n.startsWith(prefix)) {
      let base = n.slice(prefix.length).trim();

      if (base === "Internet & IT Expense") base = "Internet & Subscription Expense";
      if (base === "Internet & Subcription Expense") base = "Internet & Subscription Expense";

      return base;
    }
  }

  if (n === "ChiE_Office_Equipment_Expense") return "Office Equipment Expense";

  return n;
}

function getDepartmentLabelFromAccountName(name) {
  const n = String(name || "").trim();

  if (n === "Facilities Department Expense - General") return "Facilities";
  if (n === "Finance Department Expense - General") return "Finance";
  if (n === "Human Resource Department Expense - General") return "Human Resource";
  if (n === "Information Technology Department Expense - General") return "Information Technology";
  if (n === "Marketing Department Expense - General") return "Marketing";
  if (n === "Operation Department Expense - General") return "Operation";
  if (n === "Sales Department Expense - General") return "Sales";
  if (n === "Chiefs Expense - General") return "Chiefs";

  if (n.startsWith("FE - ")) return "Facilities";
  if (n.startsWith("Fine - ")) return "Finance";
  if (n.startsWith("HRE - ")) return "Human Resource";
  if (n.startsWith("ITE - ")) return "Information Technology";
  if (n.startsWith("ME - ")) return "Marketing";
  if (n.startsWith("OpEx - ")) return "Operation";
  if (n.startsWith("SE - ")) return "Sales";
  if (n.startsWith("ChiE - ")) return "Chiefs";
  if (n === "ChiE_Office_Equipment_Expense") return "Chiefs";

  return "Unknown Department";
}

function getDepartmentOrder(name) {
  const n = String(name || "").trim();

  if (n === "Facilities Department Expense - General") return 1;
  if (n === "Finance Department Expense - General") return 2;
  if (n === "Human Resource Department Expense - General") return 3;
  if (n === "Information Technology Department Expense - General") return 4;
  if (n === "Marketing Department Expense - General") return 5;
  if (n === "Operation Department Expense - General") return 6;
  if (n === "Sales Department Expense - General") return 7;
  if (n === "Chiefs Expense - General") return 8;

  if (n.startsWith("FE - ")) return 1;
  if (n.startsWith("Fine - ")) return 2;
  if (n.startsWith("HRE - ")) return 3;
  if (n.startsWith("ITE - ")) return 4;
  if (n.startsWith("ME - ")) return 5;
  if (n.startsWith("OpEx - ")) return 6;
  if (n.startsWith("SE - ")) return 7;
  if (n.startsWith("ChiE - ")) return 8;
  if (n === "ChiE_Office_Equipment_Expense") return 8;

  return 999;
}

function getDepartmentExpenseGroupOrder(name) {
  const order = [
    "General",
    "Advertising & Marketing",
    "Meals & Entertainment",
    "Bank Fees & Charges",
    "Travel Expense",
    "Lodging Expense",
    "Mileage Expense",
    "Telephone Expense",
    "Internet & Subscription Expense",
    "Electricity & Utilities",
    "Rent Expense",
    "Janitorial & Cleaning",
    "Security Services",
    "Postage & Shipping",
    "Repairs & Maintenance",
    "Office Supplies Expense",
    "Office Equipment Expense",
    "Depreciation Expense - Office Equipment",
    "Depreciation Expense - Store Equipment",
    "Salaries & Wages",
    "Employee Benefits",
    "Employee Allowances",
    "Professional Fees",
    "Service Fees",
    "Government Fees & Permits",
    "Taxes & Licenses",
    "Parking Fees Expense"
  ];

  const idx = order.indexOf(name);
  return idx === -1 ? 999 : idx;
}

function getCompanyExpenseOrder(name) {
  const order = [
    "Company Expenses - General",
    "Advertising & Marketing",
    "Meals & Entertainment",
    "Bank Fees & Charges",
    "Travel Expense",
    "Lodging Expense",
    "Mileage Expense",
    "Telephone Expense",
    "Internet & Subcription Expense",
    "Internet & Subscription Expense",
    "Electricity & Utilities",
    "Rent Expense",
    "Janitorial & Cleaning",
    "Security Services",
    "Office Supplies Expense",
    "Postage & Shipping",
    "Repairs & Maintenance",
    "Depreciation Expense - Office Equipment",
    "Depreciation Expense - Store Equipment",
    "Salaries & Wages Expense",
    "Freelance/Service Expense",
    "Employee Benefits",
    "Employee Allowances",
    "Professional Fees",
    "Service Fees",
    "Government Fees & Permits",
    "Taxes & Licenses",
    "Parking Fees Expense",
    "Credit Card Charges",
    "Bad Debt Expense",
    "Purchase Discounts",
    "Automobile Expense",
    "Training & Development"
  ];

  const idx = order.indexOf(String(name || "").trim());
  return idx === -1 ? 999 : idx;
}

// ✅ Live red-border validation for required fields
["je-date", "je-refno", "je-description"].forEach((id) => {
  $(id)?.addEventListener("input", () => {
    const el = $(id);
    const val = (el?.value || "").trim();
    markRequired(el, !val);
  });
});

// ==============================
// INLINE EDIT COA NAME (no prompt)
// ==============================
window.startEditCOAName = function (id) {
  const row = document.querySelector(`[data-coa-row='${id}']`);
  if (!row) return;

  row.querySelector(".coa-name-view").style.display = "none";
  row.querySelector(".coa-name-edit").style.display = "inline-block";

  row.querySelector(".coa-actions-view").style.display = "none";
  row.querySelector(".coa-actions-edit").style.display = "inline-block";
};

window.cancelEditCOAName = function () {
  renderCOA();
};

window.saveEditCOAName = async function (id) {
  const row = document.querySelector(`[data-coa-row='${id}']`);
  if (!row) return;

  const input = row.querySelector("[data-coa-edit-name]");
  const newName = (input?.value || "").trim();
  if (!newName) return alert("Name is required.");

  try {
    await sbUpdateCOA(id, { name: newName, updated_at: new Date().toISOString() });

    COA = await sbFetchCOA();
    refreshCoaDatalist();
    resolveLinesAccountIds();

    const ledgerSel = $("ledger-account");
    if (ledgerSel) ledgerSel.innerHTML = "";

    renderCOA();
    renderLedger();
    renderTrialBalance();
  } catch (e) {
    console.error(e);
    alert("Failed to update account name.");
  }
};

function closeAllCoaMenus() {
  document.querySelectorAll(".coa-menu").forEach((m) => (m.style.display = "none"));
}

window.toggleCoaMenu = function (id, ev) {
  ev?.stopPropagation?.();
  const menu = document.querySelector(`[data-coa-menu='${id}']`);
  if (!menu) return;
  const isOpen = menu.style.display === "block";
  closeAllCoaMenus();
  menu.style.display = isOpen ? "none" : "block";
};

// close menu when clicking anywhere else
document.addEventListener("click", (e) => {
  const isActionBtn = e.target?.closest?.(".coa-action-btn");
  const isMenu = e.target?.closest?.(".coa-menu");
  if (!isActionBtn && !isMenu) closeAllCoaMenus();
});

// ==============================
// DELETE COA ACCOUNT (soft delete)
// ==============================
window.deleteCOAAccount = async function (id) {
  if (!currentUser) return alert("Please login first.");

  const acct = COA.find((a) => a.id === id);
  const label = acct ? `${acct.code} - ${acct.name}` : "this account";

  const ok = confirm(`Delete ${label}?\n\n(This is soft delete and can be restored from DB if needed.)`);
  if (!ok) return;

  try {
    await sbSoftDeleteCOA(id);

    COA = await sbFetchCOA();
    refreshCoaDatalist();
    resolveLinesAccountIds();

    const ledgerSel = $("ledger-account");
    if (ledgerSel) ledgerSel.innerHTML = "";

    renderCOA();
    renderLedger();
    renderTrialBalance();
  } catch (e) {
    console.error(e);
    alert("Failed to delete account. Check RLS policies.");
  }
};

// ==============================
// COA TOOLBAR (TOP OPTIONS BAR)
// ==============================
window.focusAddAccount = function () {
  show("coa");
  $("coa-code")?.focus();
};

window.editSelectedCOA = function () {
  if (!selectedCOAId) return alert("Select an account first.");
  editAccountPrompt(selectedCOAId);
};

window.deleteSelectedCOA = function () {
  if (!selectedCOAId) return alert("Select an account first.");
  deleteCOAAccount(selectedCOAId);
};

// ==============================
// ADD ACCOUNT POPUP (LIKE EDIT)
// ==============================
window.addAccountPopup = async function () {
  if (!currentUser) return alert("Please login first.");

  const code = (prompt("Account Code (e.g. 1001):") || "").trim();
  if (!code) return;

  const name = (prompt(`Account Name for ${code}:`) || "").trim();
  if (!name) return;

  const type = (prompt("Account Type (Asset/Liability/Equity/Revenue/Expense):", "Asset") || "").trim();
  if (!type) return;

  const normal = (prompt("Normal Balance (Debit/Credit):", "Debit") || "").trim();
  if (!normal) return;

  try {
    await sbInsertCOA({
      user_id: currentUser.id,
      code,
      name,
      type,
      normal,
      is_deleted: false,
    });

    COA = await sbFetchCOA();
    refreshCoaDatalist();
    resolveLinesAccountIds();

    const ledgerSel = $("ledger-account");
    if (ledgerSel) ledgerSel.innerHTML = "";

    renderCOA();
    renderLedger();
    renderTrialBalance();

    alert("✅ Account added successfully!");
  } catch (e) {
    console.error(e);
    alert("❌ Failed to add account (maybe duplicate code).");
  }
};

window.openAddCoaModal = function () {
  $("addcoa-modal").style.display = "grid";
  $("addcoa-code").value = getNextAccountCode();
  $("addcoa-name").value = "";
  $("addcoa-type").value = "Asset";
  $("addcoa-normal").value = "Debit";
  $("addcoa-msg").textContent = "";
  $("addcoa-name").focus();
};

window.closeAddCoaModal = function () {
  $("addcoa-modal").style.display = "none";
};

window.togglePLDetail = function (className, btn) {
  const rows = document.querySelectorAll("." + className);
  let isOpening = false;

  rows.forEach((row) => {
    if (row.style.display === "none") isOpening = true;
  });

  rows.forEach((row) => {
    row.style.display = isOpening ? "table-row" : "none";
  });

  if (btn) {
    btn.textContent = isOpening ? "▼" : "▶";
  }
};

window.saveAddCoaModal = async function () {
  const code = $("addcoa-code").value.trim();
  const name = $("addcoa-name").value.trim();
  const type = $("addcoa-type").value;
  const normal = $("addcoa-normal").value;

  if (!code || !name) {
    $("addcoa-msg").textContent = "Code and Name are required.";
    return;
  }

  const exists = COA.some(
    (a) => !a.is_deleted && String(a.code).trim() === code
  );

  if (exists) {
    $("addcoa-msg").textContent = `Code ${code} already exists. Please use another code.`;
    return;
  }

  try {
    const inserted = await sbInsertCOA({
      user_id: currentUser.id,
      code,
      name,
      type,
      normal,
      is_deleted: false,
    });

    console.log("Inserted COA:", inserted);

    COA = await sbFetchCOA();
    refreshCoaDatalist();
    resolveLinesAccountIds();

    const ledgerSel = $("ledger-account");
    if (ledgerSel) ledgerSel.innerHTML = "";

    currentCOAType = "All";
    renderCOA();
    renderLedger();
    renderTrialBalance();

    closeAddCoaModal();
    alert(`✅ Account added: ${code} - ${name}`);
  } catch (e) {
    console.error("saveAddCoaModal error:", e);

    if (e?.code === "23505") {
      $("addcoa-msg").textContent = `Code ${code} already exists. Please use another code.`;
      return;
    }

    $("addcoa-msg").textContent =
      e?.message || "Failed to add account. Check your connection/policies.";
  }
};

function getNextAccountCode() {
  const codes = (COA || [])
    .filter(a => !a.is_deleted)
    .map(a => Number(String(a.code || "").replace(/[^0-9]/g, "")))
    .filter(n => Number.isFinite(n));

  if (codes.length === 0) return "1001";
  return String(Math.max(...codes) + 1);
}
