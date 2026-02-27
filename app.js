// === Mini QuickBooks Logic (COA + Journal + Ledger + Trial Balance) + AUTH (Login only) ===

// ==============================
// Local UI memory keys
// ==============================
const LAST_VIEW_KEY = "exodiaLedger.lastView.v1";
const FILTER_YEAR_KEY = "exodiaLedger.filterYear.v1";
const FILTER_MONTH_KEY = "exodiaLedger.filterMonth.v1";
const LEDGER_ACCOUNT_KEY = "exodiaLedger.ledgerAccount.v1";

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

let filterYear = "";
let filterMonth = "";

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
  return {
    id: row.id,
    journal_id: row.journal_id || null,
    is_deleted: row.is_deleted ?? false,
    entry_date: row.entry_date,
    ref: row.ref,
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
    .select("*")
    .eq("user_id", currentUser.id)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Journal fetch error:", error);
    return [];
  }

  return (data || []).map(normalizeLine);
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

  if (COA_BY_ID[raw]) return raw;
  if (COA_BY_CODE[raw]?.id) return String(COA_BY_CODE[raw].id);

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
window.applyDateFilter = function () {
  const y = $("filter-year")?.value ?? "";
  const m = $("filter-month")?.value ?? "";

  filterYear = !y || y === "All" ? "" : y;
  filterMonth = !m || m === "All" ? "" : m;

  localStorage.setItem(FILTER_YEAR_KEY, y);
  localStorage.setItem(FILTER_MONTH_KEY, m);

  renderCOA();
  renderLedger();
  renderTrialBalance();
};

// ==============================
// Tabs
// ==============================
window.show = function (view) {
  localStorage.setItem(LAST_VIEW_KEY, view);

  ["coa", "journal", "ledger", "trial", "journal-history"].forEach((v) => {
    const el = $(v);
    if (!el) return;
    el.style.display = v === view ? "block" : "none";
  });

  if (view === "coa") renderCOA();
  if (view === "ledger") renderLedger();
  if (view === "trial") renderTrialBalance();  
  if (view === "journal-history") renderHistory();
  
  // Show toolbar only on COA tab
const tb = $("coa-toolbar");
if (tb) tb.style.display = (view === "coa") ? "block" : "none";
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
  acctInput.style.width = "420px";
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
  debit.style.width = "140px";

  const credit = document.createElement("input");
  credit.placeholder = "0.00";
  credit.style.width = "140px";

  const delBtn = document.createElement("button");
  delBtn.textContent = "X";
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

    $("je-lines").innerHTML = "";
    addLine();
    addLine();

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
  const balances = computeBalances();

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
      const d = String(l.entry_date || "");
      if (filterYear && !d.startsWith(filterYear)) return false;
      if (filterMonth && Number(d.slice(5, 7)) !== Number(filterMonth)) return false;
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
    tr.innerHTML = `<td colspan="6">No transactions for this account (with current filter).</td>`;
    tbody.appendChild(tr);
  }
}

// ==============================
// Compute balances
// ==============================
function computeBalances() {
  const normals = Object.fromEntries(COA.map((a) => [a.id, a.normal]));
  const balances = {};

  lines
    .filter((l) => !l.is_deleted)
    .filter((l) => {
      const d = String(l.entry_date || "");
      if (filterYear && !d.startsWith(filterYear)) return false;
      if (filterMonth && Number(d.slice(5, 7)) !== Number(filterMonth)) return false;
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

  const yearSel = $("filter-year");
  if (yearSel) {
    const yearsFromLines = lines
      .map((l) => String(l.entry_date || "").slice(0, 4))
      .filter((y) => y && /^\d{4}$/.test(y));

    const years = Array.from(new Set(yearsFromLines)).sort();

    yearSel.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "All";
    optAll.textContent = "All";
    yearSel.appendChild(optAll);

    years.forEach((y) => {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      yearSel.appendChild(opt);
    });

    const savedYear = localStorage.getItem(FILTER_YEAR_KEY) || "All";
    const savedMonth = localStorage.getItem(FILTER_MONTH_KEY) || "";
    if ($("filter-year")) $("filter-year").value = savedYear;
    if ($("filter-month")) $("filter-month").value = savedMonth;
  }

  if ($("je-lines")) {
    $("je-lines").innerHTML = "";
    addLine();
    addLine();
  }

  applyDateFilter();

  const lastView = localStorage.getItem(LAST_VIEW_KEY) || "coa";
  show(lastView);
}

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
})();

// ==============================
// Helpers / Utils
// ==============================
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
  $("addcoa-code").value = "";
  $("addcoa-name").value = "";
  $("addcoa-type").value = "Asset";
  $("addcoa-normal").value = "Debit";
  $("addcoa-msg").textContent = "";
};

window.closeAddCoaModal = function () {
  $("addcoa-modal").style.display = "none";
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
    renderCOA();
    closeAddCoaModal();
  } catch (e) {
    console.error(e);
    $("addcoa-msg").textContent = "Failed to add account (maybe duplicate code).";
  }
};
