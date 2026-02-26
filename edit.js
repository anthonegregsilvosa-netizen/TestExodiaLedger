// ==============================
// Supabase Setup (same as app.js)
// ==============================
const SUPABASE_URL = "https://vtglfaeyvmciieuntzhs.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Z2xmYWV5dm1jaWlldW50emhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2Nzg0NDUsImV4cCI6MjA4NTI1NDQ0NX0.eDOOS3BKKcNOJ_pq5-QpQkW6d1hpp2vdYPsvzzZgZzo";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

let currentUser = null;
let COA = [];
let journalId = "";
let returnUrl = "./index.html";

// ---------- UI helpers ----------
function setStatus(msg, isErr = false) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isErr ? "crimson" : "";
}

function markRequired(el, bad) {
  if (!el) return;
  el.style.border = bad ? "2px solid crimson" : "";
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

// ---------- URL ----------
function getParam(name) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name) || "";
}

// ---------- Lines UI ----------
function addLineRow(account_id = "", debit = 0, credit = 0) {
  const tbody = $("e-lines");
  if (!tbody) return;

  const tr = document.createElement("tr");

  const sel = document.createElement("select");
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Select account...";
  sel.appendChild(opt0);

  const sorted = [...COA].sort((a, b) => {
    const ca = Number(String(a.code || "").replace(/[^0-9]/g, "")) || 999999999;
    const cb = Number(String(b.code || "").replace(/[^0-9]/g, "")) || 999999999;
    if (ca !== cb) return ca - cb;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  sorted.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = `${a.code} - ${a.name}`;
    sel.appendChild(opt);
  });

  sel.value = account_id || "";

  const inD = document.createElement("input");
  inD.placeholder = "0.00";
  inD.value = debit ? String(debit) : "";
  inD.className = "right";

  const inC = document.createElement("input");
  inC.placeholder = "0.00";
  inC.value = credit ? String(credit) : "";
  inC.className = "right";

  const del = document.createElement("button");
  del.textContent = "X";
  del.onclick = () => tr.remove();

  const td1 = document.createElement("td");
  td1.appendChild(sel);

  const td2 = document.createElement("td");
  td2.className = "right";
  td2.appendChild(inD);

  const td3 = document.createElement("td");
  td3.className = "right";
  td3.appendChild(inC);

  const td4 = document.createElement("td");
  td4.className = "right";
  td4.appendChild(del);

  tr.appendChild(td1);
  tr.appendChild(td2);
  tr.appendChild(td3);
  tr.appendChild(td4);

  tbody.appendChild(tr);
}

// ---------- Load data ----------
async function requireLogin() {
  const { data } = await sb.auth.getSession();
  currentUser = data.session?.user || null;

  if (!currentUser) {
    // go back to main page to login
    window.location.href = "./index.html";
    return false;
  }
  return true;
}

async function loadCOA() {
  try {
    COA = await fetch("./data/coa.json").then((r) => r.json());
  } catch {
    COA = [];
  }
}

async function loadJournal() {
  // Header
  const { data: entry, error: e1 } = await sb
    .from("journal_entries")
    .select("*")
    .eq("id", journalId)
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (e1) {
    console.error(e1);
    setStatus("Failed loading journal entry.", true);
    return;
  }

  if (!entry || entry.is_deleted) {
    setStatus("This entry does not exist (or already deleted).", true);
    return;
  }

  $("e-date").value = entry.entry_date || "";
  $("e-ref").value = entry.ref || "";
  $("e-desc").value = entry.description || "";
  $("e-dept").value = entry.department || "";
  $("e-pay").value = entry.payment_method || "";
  $("e-client").value = entry.client_vendor || "";
  $("e-remarks").value = entry.remarks || "";

  // Lines
  const { data: lines, error: e2 } = await sb
    .from("journal_lines")
    .select("*")
    .eq("journal_id", journalId)
    .eq("user_id", currentUser.id)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });

  if (e2) {
    console.error(e2);
    setStatus("Failed loading journal lines.", true);
    return;
  }

  $("e-lines").innerHTML = "";
  (lines || []).forEach((l) => addLineRow(l.account_id, l.debit, l.credit));

  // ensure at least 2 rows visible
  if ((lines || []).length < 2) {
    addLineRow();
    addLineRow();
  }
}

// ---------- Save ----------
async function saveChanges() {
  const entry_date = $("e-date")?.value || "";
  const ref = ($("e-ref")?.value || "").trim();
  const description = ($("e-desc")?.value || "").trim();

  // required highlight
  markRequired($("e-date"), !entry_date);
  markRequired($("e-ref"), !ref);
  markRequired($("e-desc"), !description);

  if (!entry_date || !ref || !description) {
    setStatus("Please fill all required (*) fields.", true);
    return;
  }

  const department = ($("e-dept")?.value || "").trim();
  const payment_method = ($("e-pay")?.value || "").trim();
  const client_vendor = ($("e-client")?.value || "").trim();
  const remarks = ($("e-remarks")?.value || "").trim();

  // collect line rows
  const rows = [...$("e-lines").querySelectorAll("tr")];
  const newLines = [];
  let totalD = 0;
  let totalC = 0;

  for (const r of rows) {
    const sel = r.querySelector("select");
    const inputs = r.querySelectorAll("input");
    const account_id = sel?.value || "";
    const d = parseMoney(inputs[0]?.value);
    const c = parseMoney(inputs[1]?.value);

    if (!account_id) continue;
    if (!d && !c) continue;

    totalD += d;
    totalC += c;

    const acct = COA.find((a) => a.id === account_id);
    const account_name = acct ? `${acct.code} - ${acct.name}` : "";

    newLines.push({
      user_id: currentUser.id,
      journal_id: journalId,
      entry_date,
      ref,
      account_id,
      account_name,
      debit: d,
      credit: c,
      is_deleted: false,
    });
  }

  if (newLines.length < 2) {
    setStatus("Add at least 2 lines.", true);
    return;
  }

  if (Math.abs(totalD - totalC) > 0.00001) {
    setStatus("Match the debit and credit.", true);
    return;
  }

  // 1) update header
  const { error: e1 } = await sb
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
    .eq("user_id", currentUser.id);

  if (e1) {
    console.error(e1);
    setStatus("Save failed (header). Check policies/unique ref rules.", true);
    return;
  }

  // 2) soft-delete old lines for this journal_id
  const { error: e2 } = await sb
    .from("journal_lines")
    .update({ is_deleted: true })
    .eq("journal_id", journalId)
    .eq("user_id", currentUser.id);

  if (e2) {
    console.error(e2);
    setStatus("Save failed (lines delete). Check UPDATE policy.", true);
    return;
  }

  // 3) insert fresh lines
  const { error: e3 } = await sb.from("journal_lines").insert(newLines);

  if (e3) {
    console.error(e3);
    setStatus("Save failed (lines insert). Check INSERT policy.", true);
    return;
  }

  setStatus("Saved ✅ Changes applied.");
}

// ---------- Delete ----------
async function deleteEntry() {
  const ok = confirm("Delete this journal entry? (It will be hidden, not permanently removed.)");
  if (!ok) return;

  // soft delete header
  const { error: e1 } = await sb
    .from("journal_entries")
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq("id", journalId)
    .eq("user_id", currentUser.id);

  if (e1) {
    console.error(e1);
    setStatus("Delete failed (entry). Check UPDATE policy.", true);
    return;
  }

  // soft delete lines
  const { error: e2 } = await sb
    .from("journal_lines")
    .update({ is_deleted: true })
    .eq("journal_id", journalId)
    .eq("user_id", currentUser.id);

  if (e2) {
    console.error(e2);
    setStatus("Delete failed (lines). Check UPDATE policy.", true);
    return;
  }

  setStatus("Deleted ✅ Returning to ledger...");
  setTimeout(() => (window.location.href = returnUrl), 600);
}

// ---------- Boot ----------
(async function boot() {
  journalId = getParam("journal_id");
  const acct = getParam("account_id");
  returnUrl = acct ? `./index.html#ledger?account_id=${encodeURIComponent(acct)}` : "./index.html";

  if (!journalId) {
    setStatus("Missing journal_id in URL.", true);
    return;
  }

  const ok = await requireLogin();
  if (!ok) return;

  await loadCOA();
  await loadJournal();

  $("btn-add").onclick = () => addLineRow();
  $("btn-save").onclick = saveChanges;
  $("btn-delete").onclick = deleteEntry;
  $("btn-back").onclick = () => (window.location.href = "./index.html");
})();
