const TOOL_VIEW = "graph";
/* global document, localStorage, fetch, URL, Blob */
("use strict");
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const labels = {
  customer: "Customers",
  vendor: "Vendors",
  salesorder: "Sales orders",
  purchaseorder: "Purchase orders",
  itemfulfillment: "Fulfillments",
  itemreceipt: "Receipts",
  invoice: "Invoices",
};
const symbols = {
  customer: "CU",
  vendor: "VE",
  salesorder: "SO",
  purchaseorder: "PO",
  itemfulfillment: "IF",
  itemreceipt: "IR",
  invoice: "IN",
};
const state = {
  view: TOOL_VIEW,
  page: 0,
  rows: [],
  graph: null,
  zoom: 1,
  selected: null,
  meta: null,
  evidence: null,
  activity: [],
  presets: [],
  searchRequest: 0,
  graphRequest: 0,
  detailRequest: { preview: 0, "graph-preview": 0 },
  investigationRequest: 0,
};
async function api(body) {
  const endpoint = location.pathname.includes("scriptlet.nl")
    ? location.href
    : "/api";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "Request failed");
  return data.data;
}
function notice(message = "", error = false) {
  $("notice").textContent = message;
  $("notice").className = error ? "error" : "";
}
function warnings(id, list) {
  $(id).innerHTML = list?.length
    ? `<div class="warning"><strong>Incomplete evidence</strong><ul>${list.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>`
    : "";
}
function safeRecordURL(raw) {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw, location.origin);
    return u.origin === location.origin && u.pathname.startsWith("/app/")
      ? u.href
      : null;
  } catch (_) {
    return null;
  }
}
async function selectRecord(key, target) {
  const version = ++state.detailRequest[target];
  $(target).textContent = "Loading record…";
  try {
    const r = await api({ action: "read", key });
    if (version !== state.detailRequest[target]) return;
    const link = safeRecordURL(r.url);
    $(target).innerHTML =
      `<span class="eyebrow">RECORD DETAILS</span><div class="record-symbol">${symbols[r.type] || "RE"}</div><h2>${esc(r.number)}</h2><p>${esc(r.entity)}</p><dl><div><dt>Type / internal ID</dt><dd>${esc(labels[r.type])} / ${esc(r.id)}</dd></div><div><dt>Status</dt><dd>${esc(r.status)}</dd></div><div><dt>Memo · untrusted source text</dt><dd>${esc(r.memo || "No memo")}</dd></div>${r.expectedDate ? `<div><dt>Expected receipt</dt><dd>${esc(r.expectedDate)} · ${esc(r.receivedQuantity)} / ${esc(r.quantity)} received</dd></div>` : ""}</dl>${link ? `<a class="secondary" href="${esc(link)}" target="_blank" rel="noopener">Open record in NetSuite ↗</a>` : `<small>${state.meta?.mode === "netsuite" ? "Record link unavailable." : "Fictional record. No NetSuite URL."}</small>`}`;
    document
      .querySelectorAll(".record-card")
      .forEach((b) => b.classList.toggle("selected", b.dataset.key === key));
  } catch (e) {
    if (version === state.detailRequest[target]) {
      $(target).textContent = "Record unavailable. No current evidence loaded.";
      notice(e.message, true);
    }
  }
}
async function loadGraph() {
  const request = ++state.graphRequest;
  ++state.detailRequest["graph-preview"];
  state.graph = null;
  $("graph-count").textContent = "Map not loaded";
  $("graph-preview").textContent = "No current map loaded.";
  $("graph-svg").innerHTML = "";
  $("graph-list").innerHTML = "";
  $("coverage").textContent = "";
  warnings("graph-warnings", []);
  if (!$("graph-key").value) {
    notice("Enter a NetSuite record key to start the map.");
    return;
  }
  try {
    const g = await api({
      action: "graph",
      key: $("graph-key").value,
      options: { depth: Number($("depth").value), cap: 40 },
    });
    if (request !== state.graphRequest) return;
    state.graph = g;
    state.zoom = 1;
    warnings("graph-warnings", g.warnings);
    $("graph-count").textContent =
      `${g.nodes.length} records · ${g.edges.length} links${g.partial ? " · partial map" : ""}`;
    $("coverage").textContent = g.coverage.join(" · ") + ". " + g.scope;
    drawGraph();
    $("graph-list").innerHTML = g.nodes
      .map((r) => {
        const k = r.type + ":" + r.id;
        return `<div class="graph-list-entry"><button class="secondary" data-node="${esc(k)}">${esc(r.number)} · ${esc(r.entity)}</button>${g.edges
          .filter((e) => e.from === k || e.to === k)
          .map(
            (e) =>
              `<p>${esc(e.from)} → ${esc(e.to)}<br>${esc(e.kind)} · ${esc(e.evidence)}</p>`,
          )
          .join("")}</div>`;
      })
      .join("");
    $("graph-list")
      .querySelectorAll("[data-node]")
      .forEach((b) =>
        b.addEventListener("click", () =>
          selectRecord(b.dataset.node, "graph-preview"),
        ),
      );
    selectRecord(g.root, "graph-preview");
    notice();
  } catch (e) {
    if (request === state.graphRequest) {
      notice(e.message, true);
      $("graph-count").textContent = "Map not loaded";
      state.graph = null;
    }
  }
}
function drawGraph() {
  const g = state.graph;
  if (!g) return;
  const columns = new Map(),
    positions = new Map();
  g.nodes.forEach((r) => {
    const level = r.depth;
    if (!columns.has(level)) columns.set(level, []);
    columns.get(level).push(r);
  });
  const width = Math.max(650, columns.size * 215 + 40),
    height = Math.max(
      390,
      ...[...columns.values()].map((c) => c.length * 100 + 40),
    );
  for (const [level, rs] of columns)
    rs.forEach((r, i) =>
      positions.set(r.type + ":" + r.id, {
        x: 30 + level * 215,
        y: (height - rs.length * 100) / 2 + i * 100 + 10,
      }),
    );
  state.graphExtent = { width, height };
  const svg = $("graph-svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.width = `${width * state.zoom}px`;
  svg.style.height = `${height * state.zoom}px`;
  svg.innerHTML =
    '<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="7" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="#9aac9d"/></marker></defs>' +
    g.edges
      .map((e) => {
        const a = positions.get(e.from),
          b = positions.get(e.to);
        return `<path d="M ${a.x + 145} ${a.y + 30} C ${a.x + 180} ${a.y + 30},${b.x - 35} ${b.y + 30},${b.x} ${b.y + 30}" fill="none" stroke="#b4c4b6" stroke-width="1.5" marker-end="url(#arrow)"${e.kind === "configured reference" ? ' stroke-dasharray="5 4"' : ""}><title>${esc(e.evidence)}</title></path>`;
      })
      .join("") +
    g.nodes
      .map((r) => {
        const key = r.type + ":" + r.id,
          p = positions.get(key),
          color = ["salesorder", "purchaseorder"].includes(r.type)
            ? "#d48a64"
            : r.type === "invoice"
              ? "#a997c0"
              : "#7ca891";
        return `<g class="graph-node" data-node="${esc(key)}" tabindex="0" role="button" aria-label="Inspect ${esc(r.number)}" transform="translate(${p.x},${p.y})"><rect width="145" height="62" rx="10" fill="#fffefa" stroke="${color}" stroke-width="${key === g.root ? 2.5 : 1.2}"/><circle cx="16" cy="20" r="4" fill="${color}"/><text class="svg-label" x="29" y="24" font-size="12" fill="#243a37" font-weight="600">${esc(r.number)}</text><text class="svg-label" x="13" y="45" font-size="9" fill="#718076">${esc(r.entity.slice(0, 23))}</text></g>`;
      })
      .join("");
  svg.querySelectorAll("[data-node]").forEach((n) => {
    n.addEventListener("click", () =>
      selectRecord(n.dataset.node, "graph-preview"),
    );
    n.addEventListener("keydown", (e) => {
      if (["Enter", " "].includes(e.key)) {
        e.preventDefault();
        selectRecord(n.dataset.node, "graph-preview");
      }
    });
  });
  $("zoom-label").textContent = `${Math.round(state.zoom * 100)}%`;
}

async function init() {
  $("graph-form").addEventListener("submit", (e) => {
    e.preventDefault();
    loadGraph();
  });
  $("zoom-in").addEventListener("click", () => {
    state.zoom = Math.min(2, state.zoom + 0.2);
    drawGraph();
  });
  $("zoom-out").addEventListener("click", () => {
    state.zoom = Math.max(0.4, state.zoom - 0.2);
    drawGraph();
  });
  $("zoom-reset").addEventListener("click", () => {
    if (!state.graphExtent) return;
    state.zoom = Math.min(
      1,
      Math.max(
        0.2,
        Math.min(
          ($("graph-canvas").clientWidth - 10) / state.graphExtent.width,
          ($("graph-canvas").clientHeight - 10) / state.graphExtent.height,
        ),
      ),
    );
    drawGraph();
    $("graph-canvas").scrollTo(0, 0);
  });
  let drag;
  const canvas = $("graph-canvas");
  canvas.addEventListener("pointerdown", (e) => {
    if (e.target.closest("[data-node]")) return;
    drag = {
      x: e.clientX,
      y: e.clientY,
      left: canvas.scrollLeft,
      top: canvas.scrollTop,
    };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (drag) {
      canvas.scrollLeft = drag.left + drag.x - e.clientX;
      canvas.scrollTop = drag.top + drag.y - e.clientY;
    }
  });
  for (const name of ["pointerup", "pointercancel"])
    canvas.addEventListener(name, () => {
      drag = null;
      canvas.classList.remove("dragging");
    });

  try {
    state.meta = await api({ action: "meta" });
    const live = state.meta.mode === "netsuite";
    $("environment").textContent = live
      ? "NETSUITE · READ ONLY"
      : "DEMO · FICTIONAL RECORDS";
    if (live) {
      $("footer-mode").textContent =
        "Read-only NetSuite adapter. Sandbox validation pending.";
      notice(state.meta.limitations.join(" · "));
    }
    if (live) {
      $("graph-key").value = "";
      notice("Enter a record type and internal ID to trace.");
    } else await loadGraph();
  } catch (e) {
    notice("Could not connect: " + e.message, true);
    $("environment").textContent = "CONNECTION UNAVAILABLE";
  }
}
init();
