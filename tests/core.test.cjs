const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core");
const { createFixtureAdapter, records, edges } = require("../src/fixtures");
const { createService } = require("../src/service");
const plan = {
  types: ["purchaseorder"],
  fields: ["entity"],
  query: "Cedar",
  status: "open",
  overdue: true,
};
test("vendor overdue receipt scenario isolates PO-0101", () => {
  const r = createFixtureAdapter().search(plan);
  assert.deepEqual(
    r.rows.map((r) => r.number),
    ["PO-0101"],
  );
  assert.deepEqual(r.rows[0].reasons, ["entity: contains match"]);
});
test("exact type selection and ambiguous prefixes never expand scope", () => {
  assert.throws(
    () => core.validatePlan({ ...plan, types: ["po"] }),
    /record types/,
  );
  const a = createFixtureAdapter();
  const r = a.search({
    ...plan,
    overdue: false,
    query: "Cedar",
    types: ["customer"],
  });
  assert.deepEqual(
    r.rows.map((x) => x.type),
    ["customer"],
  );
});
test("unknown options, custom fields, operators and empty scopes are rejected", () => {
  for (const patch of [
    { fields: ["custbody_secret"] },
    { match: "sql" },
    { types: [] },
    { query: 123 },
    { page: -1 },
    { pageSize: 100 },
    { sql: "DROP" },
    { fields: [] },
    { overdue: "true" },
  ])
    assert.throws(() => core.validatePlan({ ...plan, ...patch }));
});
test("literal query parameters and exact search cannot inject additional results", () => {
  const a = createFixtureAdapter();
  assert.equal(a.search({ ...plan, query: "' OR 1=1 --" }).total, 0);
  assert.equal(a.search({ ...plan, query: "Cedar", match: "exact" }).total, 0);
  assert.equal(
    a.search({ ...plan, query: "Cedar Supply", match: "exact" }).total,
    1,
  );
});
test("inactive entities excluded by default, explicit toggle includes them", () => {
  const a = createFixtureAdapter();
  const p = { types: ["vendor"], fields: ["entity"], query: "Cedar" };
  assert.equal(a.search(p).total, 1);
  assert.equal(a.search({ ...p, includeInactive: true }).total, 2);
});
test("denied records cannot be searched or read", () => {
  const a = createFixtureAdapter();
  assert.equal(a.search({ types: ["invoice"], query: "RESTRICTED" }).total, 0);
  assert.throws(() => a.read("invoice:499"), /unavailable/);
  assert.throws(() => a.read("invoice:1?x=2"));
});
test("stable paging has no duplicates and reports empty results honestly", () => {
  const a = createFixtureAdapter();
  const p = { types: core.TYPES, query: "", pageSize: 3 };
  const all = [];
  for (let page = 0; page < 6; page++)
    all.push(...a.search({ ...p, page }).rows.map(core.keyOf));
  assert.equal(new Set(all).size, 17);
  assert.equal(a.search({ ...p, page: 100 }).rows.length, 0);
  assert.equal(a.search({ ...p, query: "not present" }).total, 0);
});
test("graph follows split fulfillments and invoices without exposing denied record", () => {
  const r = core.graph(createFixtureAdapter(), "salesorder:201");
  assert.equal(r.nodes.filter((n) => n.type === "itemfulfillment").length, 2);
  assert.equal(r.nodes.filter((n) => n.type === "invoice").length, 2);
  assert.equal(r.partial, true);
  assert.ok(r.warnings.some((w) => w.includes("unavailable")));
  assert.ok(!JSON.stringify(r).includes("RESTRICTED"));
  assert.ok(!r.edges.some((e) => e.to === "invoice:499"));
});
test("graph deduplicates links and cycles and respects depth/node caps", () => {
  const a = createFixtureAdapter({
    edges: [
      ...edges,
      ...edges,
      {
        from: "invoice:401",
        to: "salesorder:201",
        kind: "cycle",
        evidence: "fixture",
      },
    ],
  });
  const g = core.graph(a, "salesorder:201", { cap: 3, depth: 5 });
  assert.equal(g.nodes.length, 3);
  assert.ok(g.partial);
  assert.equal(
    new Set(g.edges.map((e) => e.from + e.to + e.kind)).size,
    g.edges.length,
  );
  assert.equal(core.graph(a, "salesorder:201", { depth: 0 }).nodes.length, 1);
});
test("graph source failures surface as partial; root denial is an error", () => {
  const a = createFixtureAdapter();
  a.neighbors = () => {
    throw new Error("Private failure text");
  };
  const r = core.graph(a, "salesorder:201");
  assert.ok(r.partial);
  assert.ok(!JSON.stringify(r).includes("Private failure"));
  assert.throws(() => core.graph(a, "invoice:499"));
});
test("diagnosis supports known causes and abstains for ambiguous/contradictory/denied evidence", () => {
  const a = createFixtureAdapter();
  assert.equal(
    core.investigate(a, "salesorder:201").action.kind,
    "request_approval_review",
  );
  assert.match(
    core.investigate(a, "salesorder:202").title,
    /No additional fulfilled/,
  );
  assert.equal(core.investigate(a, "salesorder:203").decision, "escalate");
  assert.equal(core.investigate(a, "salesorder:204").decision, "resolved");
  assert.equal(core.investigate(a, "salesorder:205").decision, "escalate");
  assert.equal(core.investigate(a, "salesorder:206").decision, "escalate");
});
test("mismatched evidence revision forces escalation", () => {
  const a = createFixtureAdapter();
  const f = a.billing("salesorder:201");
  f.revision = "new";
  assert.equal(core.diagnose(a.read("salesorder:201"), f).decision, "escalate");
});
test("memo injection cannot change diagnosis or action", () => {
  const r = core.investigate(createFixtureAdapter(), "salesorder:201");
  assert.equal(r.action.kind, "request_approval_review");
  assert.ok(!JSON.stringify(r).includes("Ignore previous"));
});
test("malformed, zero-quantity and overflowing billing evidence cannot support a conclusion", () => {
  const a = createFixtureAdapter(),
    order = a.read("salesorder:201");
  for (const facts of [
    null,
    { complete: "yes", lines: [], warnings: [], revision: "1" },
    { complete: true, lines: null, warnings: [], revision: "1" },
    { complete: true, lines: [null], warnings: [], revision: "1" },
    {
      complete: true,
      lines: [{ ordered: 0, fulfilled: 0, billed: 0 }],
      warnings: [],
      revision: "1",
    },
    {
      complete: true,
      lines: [
        { ordered: 1e308, fulfilled: 0, billed: 0 },
        { ordered: 1e308, fulfilled: 0, billed: 0 },
      ],
      warnings: [],
      revision: "1",
    },
  ]) {
    const r = core.diagnose(order, facts);
    assert.equal(r.decision, "escalate");
    assert.equal(r.action, null);
  }
});
test("service rejects inherited action names, arrays, extra arguments and invalid graph options", () => {
  const s = createService(createFixtureAdapter());
  for (const body of [
    [],
    { action: "constructor" },
    { action: "meta", config: {} },
    { action: "graph", key: "salesorder:201", options: null },
    {
      action: "graph",
      key: "salesorder:201",
      options: { depth: 1, sql: "raw" },
    },
  ])
    assert.throws(() => s.route(body), { code: "INVALID_INPUT" });
});
