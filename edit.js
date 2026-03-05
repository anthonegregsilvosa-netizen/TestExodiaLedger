// ==============================
// EDIT.JS (FULL WORKING)
// ==============================

// --- MUST MATCH YOUR app.js ---
const SUPABASE_URL = "https://pezowkprqtawqzqxjtzb.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlem93a3BycXRhd3F6cXhqdHpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNzY5MDYsImV4cCI6MjA4NzY1MjkwNn0.OJuLSgh4_zTXpl5OWaEK9HdoFfnPF-TTx2rZCZN5rlQ";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log("✅ edit.js loaded"); // you should see this in console

const $ = (id) => document.getElementById(id);

function setStatus(msg, isErr = false) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isErr ? "crimson" : "";
}

function getQueryParam(name) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name) || "";
}

function parseMoney(v) {
  const cleaned = String(v || "").replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function money(n) {
  return (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ==============================
// COA loading + resolver
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

// Old records might store account_id as code (like "1004").
// New records store account_id as uuid.
// This converts to uuid if possible.
function resolveAccountId(rawAccountId, accountName) {
  const raw = String(rawAccountId || "").trim();
  if (!raw) return "";

  // already a uuid id in COA
  if (COA_BY_ID[raw]) return raw;

  // maybe code
  if (COA_BY_CODE[raw]?.id) return String(COA_BY_CODE[raw].id);

  // maybe in account_name "1004 - Bank..."
  const t = String(accountName || "");
  if (t.includes(" - ")) {
    const code = t.split(" - ")[0].trim();
    if (COA_BY_CODE[code]?.id) return String(COA_BY_CODE[code].id);
  }

  return raw;
}

async function loadCOA(userId) {
  const { data, error } = await sb
    .from("coa_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("is_deleted", false)
    .order("code", { ascending: true });

  if (error) throw error;

  COA = (data || []).map((r) => ({
    id: r.id,
    code: r.code || "",
    name: r.name || "",
    type: r.type || "",
    normal: r.normal || "",
  }));

  rebuildCoaIndex();
}

// ==============================
// Fetch entry + lines
// ==============================
async function fetchEntry(journalId, userId) {
  const { data, error } = await sb
    .from("journal_entries")
    .select("*")
    .eq("id", journalId)
    .eq("user_id", userId)
    .single();

  if (error) throw error;
  return data;
}

async function fetchLines(journalId, userId, entryDate, ref) {
  // try normal linked lines
  const { data: linked, error: e1 } = await sb
    .from("journal_lines")
    .select("*")
    .eq("journal_id", journalId)
    .eq("user_id", userId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });

  if (e1) throw e1;
  if (linked && linked.length) return linked;

  // fallback for old rows (matched by date+ref)
  const { data: legacy, error: e2 } = await sb
    .from("journal_lines")
    .select("*")
    .eq("user_id", userId)
    .eq("is_deleted", false)
    .eq("entry_date", entryDate)
    .eq("ref", ref)
    .order("created_at", { ascending: true });

  if (e2) throw e2;

  // repair: attach journal_id to legacy rows if they were null
  if (legacy && legacy.length) {
    await sb
      .from("journal_lines")
      .update({ journal_id: journalId })
      .eq("user_id", userId)
      .eq("entry_date", entryDate)
      .eq("ref", ref)
      .is("journal_id", null);
  }

  return legacy || [];
}

// ==============================
// Render lines table
// ==============================
function buildAccountSelect(selectedId) {
  const sel = document.createElement("select");

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Select account...";
  sel.appendChild(opt0);

  COA.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.id; // ✅ uuid
    opt.textContent = `${a.code} - ${a.name}`;
    sel.appendChild(opt);
  });

  if (selectedId) sel.value = selectedId;
  return sel;
}

function addEmptyLine(prefill = null) {
  const tbody = $("e-lines");
  if (!tbody) return;

  const tr = document.createElement("tr");

  // account
  const tdA = document.createElement("td");

  const resolved = prefill
    ? resolveAccountId(prefill.account_id, prefill.account_name)
    : "";

  const sel = buildAccountSelect(resolved);
  tdA.appendChild(sel);

  // debit
  const tdD = document.createElement("td");
  tdD.className = "right";
  const iD = document.createElement("input");
  iD.type = "text";
  iD.value = prefill ? money(prefill.debit) : "0.00";
  tdD.appendChild(iD);

  // credit
  const tdC = document.createElement("td");
  tdC.className = "right";
  const iC = document.createElement("input");
  iC.type = "text";
  iC.value = prefill ? money(prefill.credit) : "0.00";
  tdC.appendChild(iC);

  // delete row button
  const tdX = document.createElement("td");
  const bx = document.createElement("button");
  bx.textContent = "X";
  bx.onclick = () => tr.remove();
  tdX.appendChild(bx);

  tr.appendChild(tdA);
  tr.appendChild(tdD);
  tr.appendChild(tdC);
  tr.appendChild(tdX);

  tbody.appendChild(tr);
}

function renderLines(lines) {
  const tbody = $("e-lines");
  if (!tbody) return;
  tbody.innerHTML = "";
  (lines || []).forEach((l) => addEmptyLine(l));
  if ((lines || []).length === 0) {
    addEmptyLine();
    addEmptyLine();
  }
}

function collectLinesFromUI() {
  const tbody = $("e-lines");
  const rows = [...(tbody?.querySelectorAll("tr") || [])];

  const out = rows
    .map((tr) => {
      const sel = tr.querySelector("select");
      const inputs = tr.querySelectorAll("input");
      const account_uuid = sel?.value || "";
      const debit = parseMoney(inputs?.[0]?.value);
      const credit = parseMoney(inputs?.[1]?.value);
      return { account_uuid, debit, credit };
    })
    .filter((x) => x.account_uuid && (x.debit !== 0 || x.credit !== 0));

  return out;
}

function isBalanced(lines) {
  let d = 0,
    c = 0;
  lines.forEach((l) => {
    d += l.debit;
    c += l.credit;
  });
  return Math.abs(d - c) < 0.00001;
}

// ==============================
// SAVE + DELETE
// ==============================
async function saveChanges(journalId, userId) {
  const entry_date = $("e-date")?.value || "";
  const ref = ($("e-ref")?.value || "").trim();
  const description = ($("e-desc")?.value || "").trim();
  const department = ($("e-dept")?.value || "").trim();
  const payment_method = ($("e-pay")?.value || "").trim();
  const client_vendor = ($("e-client")?.value || "").trim();
  const remarks = ($("e-remarks")?.value || "").trim();

  if (!entry_date || !ref || !description) {
    setStatus("Fill Date, Ref No, and Description.", true);
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

  // 1) update header
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
    setStatus("Header update failed (RLS/policy).", true);
    return;
  }

  // 2) soft delete old lines
  const { error: delErr } = await sb
    .from("journal_lines")
    .update({ is_deleted: true })
    .eq("journal_id", journalId)
    .eq("user_id", userId);

  if (delErr) {
    console.error(delErr);
    setStatus("Failed to update lines (soft delete).", true);
    return;
  }

  // 3) insert fresh lines
  const fresh = uiLines.map((l) => {
    const acct = COA_BY_ID[l.account_uuid];
    const account_name = acct ? `${acct.code} - ${acct.name}` : "";

    return {
      user_id: userId,
      journal_id: journalId,
      entry_date,
      ref,
      account_id: l.account_uuid, // ✅ uuid always
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
    setStatus("Insert failed (RLS/policy).", true);
    return;
  }

 setStatus("Saved ✅");

    // ✅ go back to ledger after save
  const acctId = getQueryParam("account_id") || "";
  const url = new URL("./index.html", window.location.href);
  url.searchParams.set("account_id", acctId);
  url.hash = "ledger";
  window.location.replace(url.toString());
  return;
}

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
    setStatus("Failed to delete entry (RLS/policy).", true);
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

  // ✅ go back to ledger
  const acctId = getQueryParam("account_id") || "";
  const url = new URL("./index.html", window.location.href);
  url.searchParams.set("account_id", acctId);
  url.hash = "ledger";
  window.location.replace(url.toString());
}

// ==============================
// INIT
// ==============================
(async function initEditPage() {
  try {
    const journalId = getQueryParam("journal_id");
    if (!journalId) {
      setStatus("Missing journal_id in URL", true);
      return;
    }

    const { data, error } = await sb.auth.getSession();
    if (error) throw error;

    const user = data?.session?.user;
    if (!user) {
      setStatus("Please login first (open index.html and login).", true);
      return;
    }

    // load COA first so selects have options
    await loadCOA(user.id);

    // load entry + fill header fields
    const entry = await fetchEntry(journalId, user.id);

    $("e-date").value = entry.entry_date || "";
    $("e-ref").value = entry.ref || "";
    $("e-desc").value = entry.description || "";
    $("e-dept").value = entry.department || "";
    $("e-pay").value = entry.payment_method || "";
    $("e-client").value = entry.client_vendor || "";
    $("e-remarks").value = entry.remarks || "";

    // load + render lines
const jLines = await fetchLines(journalId, user.id, entry.entry_date, entry.ref);
renderLines(jLines);

    // wire buttons
    $("btn-add").onclick = () => addEmptyLine();
    $("btn-save").onclick = () => saveChanges(journalId, user.id);
    $("btn-delete").onclick = () => deleteEntry(journalId, user.id);
    $("btn-back").onclick = () => {
      const acctId = getQueryParam("account_id") || "";
      window.location.href = `./index.html?account_id=${encodeURIComponent(acctId)}#ledger`;
    };

    setStatus("Loaded ✅");
  } catch (e) {
    console.error(e);
    setStatus(e?.message || "Failed to load edit page.", true);
  }
})();
