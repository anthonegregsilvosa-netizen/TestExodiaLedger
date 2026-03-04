// ==============================
// Supabase Setup (same as app.js)
// ==============================
const SUPABASE_URL = "https://pezowkprqtawqzqxjtzb.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlem93a3BycXRhd3F6cXhqdHpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNzY5MDYsImV4cCI6MjA4NzY1MjkwNn0.OJuLSgh4_zTXpl5OWaEK9HdoFfnPF-TTx2rZCZN5rlQ";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

// ==============================
// Helpers
// ==============================
function getQueryParam(name) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name) || "";
}

function setStatus(msg, isErr = false) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isErr ? "crimson" : "";
}

function parseMoney(v) {
  const cleaned = String(v || "").replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function codeNum(code) {
  const n = Number(String(code || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? n : 999999999;
}

// ==============================
// COA index + resolver
// ==============================
let COA = [];
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

// FIX: old rows may store account_id as CODE (1004) or UUID.
// This makes sure we always get the UUID that matches COA.
function resolveAccountId(rawAccountId, accountName) {
  const raw = String(rawAccountId || "").trim();
  if (!raw) return "";

  // already UUID
  if (COA_BY_ID[raw]) return raw;

  // if it is code like "1004"
  if (COA_BY_CODE[raw]?.id) return String(COA_BY_CODE[raw].id);

  // try parse from "1004 - Bank..."
  const code = parseCodeFromAccountName(accountName);
  if (code && COA_BY_CODE[code]?.id) return String(COA_BY_CODE[code].id);

  return raw;
}

// ==============================
// Fetch COA for edit page
// ==============================
async function sbFetchCOA(userId) {
  const { data, error } = await sb
    .from("coa_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("is_deleted", false)
    .order("code", { ascending: true });

  if (error) throw error;
  return data || [];
}

// ==============================
// Build account <select>
// ==============================
function buildAccountSelect(selectedIdOrCode, fallbackName = "") {
  const sel = document.createElement("select");

  const sorted = [...COA].sort((a, b) => {
    const ca = codeNum(a.code);
    const cb = codeNum(b.code);
    if (ca !== cb) return ca - cb;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  sorted.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = String(a.id); // UUID
    opt.textContent = `${a.code} - ${a.name}`;
    sel.appendChild(opt);
  });

  // resolve and set selected
  const resolved = resolveAccountId(selectedIdOrCode, fallbackName);

  // if resolved not found in COA, add a fallback option (so it doesn't look blank)
  if (resolved && ![...sel.options].some((o) => o.value === resolved)) {
    const opt = document.createElement("option");
    opt.value = resolved;
    opt.textContent = fallbackName || "(Unknown account)";
    sel.prepend(opt);
  }

  sel.value = resolved || (sel.options[0]?.value ?? "");
  return sel;
}

// ==============================
// Load entry + lines (by journal_id)
// ==============================
async function fetchEntry(journalId) {
  const { data, error } = await sb
    .from("journal_entries")
    .select("*")
    .eq("id", journalId)
    .single();

  if (error) throw error;
  return data;
}

async function fetchLines(journalId) {
  const { data, error } = await sb
    .from("journal_lines")
    .select("*")
    .eq("journal_id", journalId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

// ==============================
// Render lines in edit page
// ==============================
function renderLines(lines) {
  const tbody = $("e-lines");
  if (!tbody) return;
  tbody.innerHTML = "";

  lines.forEach((l) => {
    const tr = document.createElement("tr");

    // account select
    const tdAcct = document.createElement("td");
    const sel = buildAccountSelect(l.account_id, l.account_name);
    tdAcct.appendChild(sel);

    // debit
    const tdD = document.createElement("td");
    tdD.className = "right";
    const inD = document.createElement("input");
    inD.type = "text";
    inD.value = Number(l.debit || 0).toFixed(2);
    tdD.appendChild(inD);

    // credit
    const tdC = document.createElement("td");
    tdC.className = "right";
    const inC = document.createElement("input");
    inC.type = "text";
    inC.value = Number(l.credit || 0).toFixed(2);
    tdC.appendChild(inC);

    // delete line button (soft delete on save, or remove row locally)
    const tdX = document.createElement("td");
    const btnX = document.createElement("button");
    btnX.textContent = "X";
    btnX.onclick = () => tr.remove();
    tdX.appendChild(btnX);

    // store line id so we can update later
    tr.dataset.lineId = l.id;

    tr.appendChild(tdAcct);
    tr.appendChild(tdD);
    tr.appendChild(tdC);
    tr.appendChild(tdX);

    tbody.appendChild(tr);
  });
}

// ==============================
// Add new empty line
// ==============================
function addEmptyLine() {
  const tbody = $("e-lines");
  if (!tbody) return;

  const tr = document.createElement("tr");

  const tdAcct = document.createElement("td");
  const sel = buildAccountSelect("");
  tdAcct.appendChild(sel);

  const tdD = document.createElement("td");
  tdD.className = "right";
  const inD = document.createElement("input");
  inD.type = "text";
  inD.value = "0.00";
  tdD.appendChild(inD);

  const tdC = document.createElement("td");
  tdC.className = "right";
  const inC = document.createElement("input");
  inC.type = "text";
  inC.value = "0.00";
  tdC.appendChild(inC);

  const tdX = document.createElement("td");
  const btnX = document.createElement("button");
  btnX.textContent = "X";
  btnX.onclick = () => tr.remove();
  tdX.appendChild(btnX);

  tr.appendChild(tdAcct);
  tr.appendChild(tdD);
  tr.appendChild(tdC);
  tr.appendChild(tdX);

  tbody.appendChild(tr);
}

// ==============================
// SAVE + DELETE (Edit page)
// ==============================

// Collect UI lines from the table
function collectLinesFromUI() {
  const tbody = $("e-lines");
  const rows = [...(tbody?.querySelectorAll("tr") || [])];

  const items = rows.map((tr) => {
    const sel = tr.querySelector("select");
    const inputs = tr.querySelectorAll("input");

    const debit = parseMoney(inputs?.[0]?.value);
    const credit = parseMoney(inputs?.[1]?.value);

    return {
      lineId: tr.dataset.lineId || null,
      account_uuid: sel?.value || "",
      debit,
      credit,
    };
  });

  // remove empty rows
  return items.filter((x) => x.account_uuid && (x.debit !== 0 || x.credit !== 0));
}

function isBalanced(lines) {
  let d = 0, c = 0;
  lines.forEach((l) => { d += l.debit; c += l.credit; });
  return Math.abs(d - c) < 0.00001;
}

// Save: update header + replace all lines
async function saveChanges(journalId, userId) {
  const entry_date = $("e-date")?.value || "";
  const ref = ($("e-ref")?.value || "").trim();
  const description = ($("e-desc")?.value || "").trim();
  const department = ($("e-dept")?.value || "").trim();
  const payment_method = ($("e-pay")?.value || "").trim();
  const client_vendor = ($("e-client")?.value || "").trim();
  const remarks = ($("e-remarks")?.value || "").trim();

  if (!entry_date || !ref || !description) {
    setStatus("Fill Date, Ref No, and Description first.", true);
    return;
  }

  const uiLines = collectLinesFromUI();
  if (uiLines.length < 2) {
    setStatus("Add at least 2 lines.", true);
    return;
  }

  if (!isBalanced(uiLines)) {
    setStatus("Not balanced ❌ Debit must equal Credit.", true);
    return;
  }

  setStatus("Saving...");

  // 1) Update journal header
  const { error: headErr } = await sb
    .from("journal_entries")
    .update({
      entry_date,
      ref,
      description,
      department,
      payment_method,
      client_vendor,
      remarks,
      updated_at: new Date().toISOString(),
    })
    .eq("id", journalId)
    .eq("user_id", userId);

  if (headErr) {
    console.error(headErr);
    setStatus("Failed to update entry header. Check RLS/policies.", true);
    return;
  }

  // 2) Soft-delete all existing lines for this journal (simplest + reliable)
  const { error: delLinesErr } = await sb
    .from("journal_lines")
    .update({ is_deleted: true })
    .eq("journal_id", journalId)
    .eq("user_id", userId);

  if (delLinesErr) {
    console.error(delLinesErr);
    setStatus("Failed to update lines (soft delete).", true);
    return;
  }

  // 3) Insert fresh lines from UI
  const fresh = uiLines.map((l) => {
    const acct = COA_BY_ID[l.account_uuid];
    const account_name = acct ? `${acct.code} - ${acct.name}` : "";

    return {
      user_id: userId,
      journal_id: journalId,
      entry_date,
      ref,
      account_id: l.account_uuid,     // ✅ always UUID now
      account_name,
      debit: l.debit,
      credit: l.credit,
      is_deleted: false,
      created_at: new Date().toISOString(),
    };
  });

  const { error: insErr } = await sb.from("journal_lines").insert(fresh);

  if (insErr) {
    console.error(insErr);
    setStatus("Failed to insert updated lines.", true);
    return;
  }

  setStatus("Saved ✅");

  // Reload lines so the table stores real IDs again
  const lines = await fetchLines(journalId);
  renderLines(lines);
}

// Delete: soft delete entry + lines
async function deleteEntry(journalId, userId) {
  const ok = confirm("Delete this journal entry?\n\n(This is soft delete.)");
  if (!ok) return;

  setStatus("Deleting...");

  const { error: e1 } = await sb
    .from("journal_entries")
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq("id", journalId)
    .eq("user_id", userId);

  if (e1) {
    console.error(e1);
    setStatus("Failed to delete journal entry.", true);
    return;
  }

  const { error: e2 } = await sb
    .from("journal_lines")
    .update({ is_deleted: true })
    .eq("journal_id", journalId)
    .eq("user_id", userId);

  if (e2) {
    console.error(e2);
    setStatus("Entry deleted, but failed to delete lines.", true);
    return;
  }

  setStatus("Deleted ✅");

  // Go back to ledger
  const acctId = getQueryParam("account_id") || "";
  window.location.href = `./index.html?account_id=${encodeURIComponent(acctId)}#ledger`;
}

// ==============================
// Init Edit Page
// ==============================
(async function initEditPage() {
  try {
    setStatus("Loading...");

    const { data } = await sb.auth.getSession();
    const session = data.session;
    if (!session?.user) {
      setStatus("Not logged in. Please login first.", true);
      return;
    }

    const user = session.user;

    const journalId = getQueryParam("journal_id");
    if (!journalId) {
      setStatus("Missing journal_id in URL.", true);
      return;
    }

    // 1) Load COA first
    COA = await sbFetchCOA(user.id);
    rebuildCoaIndex();

    // 2) Load entry header
    const entry = await fetchEntry(journalId);
    $("e-date").value = entry.entry_date || "";
    $("e-ref").value = entry.ref || "";
    $("e-desc").value = entry.description || "";
    $("e-dept").value = entry.department || "";
    $("e-pay").value = entry.payment_method || "";
    $("e-client").value = entry.client_vendor || "";
    $("e-remarks").value = entry.remarks || "";

    // 3) Load lines and render
    const lines = await fetchLines(journalId);
    renderLines(lines);

    // Buttons
   $("btn-add").onclick = addEmptyLine;
$("btn-save").onclick = () => saveChanges(journalId, user.id);
$("btn-delete").onclick = () => deleteEntry(journalId, user.id);

    // Back button (keeps account_id in URL if present)
    $("btn-back").onclick = () => {
      const acctId = getQueryParam("account_id") || "";
      window.location.href = `./index.html?account_id=${encodeURIComponent(acctId)}#ledger`;
    };

    setStatus("Loaded ✅");
  } catch (e) {
    console.error(e);
    setStatus("Failed to load edit page. Check console.", true);
  }
})();
