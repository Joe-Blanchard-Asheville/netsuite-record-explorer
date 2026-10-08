const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const core = require("../src/core");
function amd(path, deps) {
  let result;
  vm.runInNewContext(fs.readFileSync(path, "utf8"), {
    define: (names, fn) => {
      result = fn(...names.map((n) => deps[n]));
    },
    Map,
    Set,
    Date,
    JSON,
    Math,
  });
  return result;
}
function harness({
  failSearch = false,
  denied = false,
  count = 1,
  remaining = 1000,
  config = {},
  parentType = "salesorder",
  createdFrom = "",
  recordType = null,
  quantity = 10,
} = {}) {
  const queries = [],
    urlCalls = [],
    loads = [];
  const raw = {
    id: "101",
    getValue: ({ name }) =>
      ({
        entityid: "V-1",
        companyname: "Cedar Supply",
        comments: "fixture",
        isinactive: false,
        tranid: "SO-101",
        memo: "example",
        statusref: "pending",
      })[name],
    getText: ({ name }) => (name === "entity" ? "Cedar Supply" : "Pending"),
  };
  const search = {
    Type: {
      CUSTOMER: "customer",
      VENDOR: "vendor",
      SALES_ORDER: "salesorder",
      PURCHASE_ORDER: "purchaseorder",
      ITEM_FULFILLMENT: "itemfulfillment",
      ITEM_RECEIPT: "itemreceipt",
      INVOICE: "invoice",
      TRANSACTION: "transaction",
    },
    Sort: { ASC: "ASC" },
    Operator: { IS: "IS", CONTAINS: "CONTAINS" },
    createColumn: (x) => x,
    createFilter: (x) => x,
    create: (q) => {
      queries.push(q);
      if (failSearch) throw new Error("account-private-detail");
      return {
        run: () => ({
          getRange: () => [{ recordType: parentType, id: String(createdFrom) }],
        }),
        runPaged: ({ pageSize }) => {
          assert.ok(pageSize >= 5);
          return { count, fetch: () => ({ data: count ? [raw] : [] }) };
        },
      };
    },
  };
  const rec = {
    getValue: ({ fieldId }) =>
      ({
        tranid: "SO-101",
        entity: "10",
        memo: "fixture",
        status: "Pending",
        lastmodifieddate: "revision-1",
        orderstatus: "TEST_HOLD",
        createdfrom: createdFrom,
      })[fieldId],
    getText: () => "Cedar Supply",
    getLineCount: () => 1,
    getSublistValue: ({ fieldId }) =>
      ({ quantity, quantityfulfilled: 6, quantitybilled: 4 })[fieldId],
  };
  const record = {
    Type: search.Type,
    load: (x) => {
      loads.push(x);
      if (denied) throw new Error("permission");
      return { ...rec, type: recordType || x.type };
    },
  };
  const url = {
    resolveRecord: (x) => {
      urlCalls.push(x);
      return "/app/accounting/transactions/salesord.nl?id=" + x.recordId;
    },
  };
  const runtime = {
    getCurrentScript: () => ({ getRemainingUsage: () => remaining }),
  };
  const module = amd("src/netsuite-adapter.js", {
    "N/search": search,
    "N/record": record,
    "N/url": url,
    "N/runtime": runtime,
    "./core": core,
  });
  return {
    adapter: module.createAdapter(config),
    queries,
    urlCalls,
    loads,
    rec,
  };
}
test("native search uses exact types, unique sort and bound values; no raw user formulas", () => {
  const h = harness();
  h.adapter.search({
    types: ["salesorder"],
    fields: ["number", "entity"],
    query: "x' OR 1=1",
  });
  assert.equal(h.queries[0].type, "salesorder");
  assert.equal(h.queries[0].columns[0].name, "internalid");
  assert.equal(h.queries[0].columns[0].sort, "ASC");
  const or = h.queries[0].filters.at(-1);
  assert.equal(or[2].formula, "{entity}");
  assert.equal(or[2].values, "x' OR 1=1");
  assert.ok(h.urlCalls.length);
});
test("native adapter rejects unsupported filter mapping and arbitrary record types", () => {
  const a = harness().adapter;
  assert.throws(
    () => a.search({ types: ["purchaseorder"], status: "open" }),
    /mapping/,
  );
  assert.throws(() => a.search({ types: ["employee"] }));
  assert.throws(() => a.read("employee:123"));
});
test("native cap, source failures and low governance are explicit partial results", () => {
  for (const opts of [
    { count: 250 },
    { failSearch: true },
    { remaining: 100 },
  ]) {
    const r = harness(opts).adapter.search({
      types: ["salesorder"],
      query: "",
    });
    assert.equal(r.partial, true);
    assert.ok(r.warnings.length);
    assert.ok(!JSON.stringify(r).includes("account-private-detail"));
  }
});
test("native read preserves role errors; URLs resolved by N/url", () => {
  assert.throws(() => harness({ denied: true }).adapter.read("salesorder:101"));
  const h = harness();
  const r = h.adapter.read("salesorder:101");
  assert.equal(r.approved, null);
  assert.equal(h.loads[0].type, "salesorder");
  assert.equal(h.urlCalls[0].recordId, "101");
});
test("live investigator stays evidence-only even with a global policy flag", () => {
  const a = harness().adapter;
  assert.equal(core.investigate(a, "salesorder:101").decision, "escalate");
  const h = harness({
    config: {
      schemaValidated: true,
      pendingOrderStatuses: ["TEST_HOLD"],
      approvedOrderStatuses: [],
      requiresFulfillment: true,
    },
  });
  const r = core.investigate(h.adapter, "salesorder:101");
  assert.equal(r.decision, "escalate");
  assert.equal(r.action, null);
  assert.match(r.findings.join(" "), /line-level/);
  assert.equal(h.loads.length, 1);
});
test("Suitelet denies anonymous users and rejects mutation paths", () => {
  function run(id, action, config = { deploymentValidated: true }) {
    let body = "";
    let invoked = false;
    const mod = amd(
      "netsuite/FileCabinet/SuiteScripts/RecordExplorer/suitelet.js",
      {
        "N/file": {},
        "N/runtime": { getCurrentUser: () => ({ id }) },
        "./netsuite-adapter": { createAdapter: () => ({}) },
        "./service": {
          createService: () => ({
            route: () => {
              invoked = true;
            },
          }),
        },
        "./account-config": config,
      },
    );
    mod.onRequest({
      request: { method: "POST", body: JSON.stringify({ action }) },
      response: {
        setHeader() {},
        write: (options) => {
          assert.equal(typeof options, "object");
          assert.equal(typeof options.output, "string");
          body = options.output;
        },
      },
    });
    return { body: JSON.parse(body), invoked };
  }
  for (const id of [-4, 0, undefined, "bad", Infinity]) {
    assert.match(run(id, "meta").body.error, /Authentication/);
    assert.equal(run(id, "meta").invoked, false);
  }
  assert.equal(run(3, "search", {}).invoked, false);
  assert.match(run(3, "search", {}).body.error, /permission review/);
  assert.equal(run(-4, "meta").invoked, false);
  assert.equal(run(3, "approve_simulation").invoked, false);
  assert.ok(run(3, "approve_simulation").body.error);
});

test("native parent resolution uses the actual transaction type and refuses unsupported parents", () => {
  const supported = harness({ createdFrom: "201" });
  const good = supported.adapter.neighbors("itemfulfillment:301");
  assert.equal(good.edges[0].from, "salesorder:201");
  assert.equal(supported.queries[0].type, "transaction");
  const unsupported = harness({
    createdFrom: "901",
    parentType: "transferorder",
  });
  const partial = unsupported.adapter.neighbors("itemfulfillment:301");
  assert.equal(partial.edges.length, 0);
  assert.equal(partial.warnings.length, 1);
  assert.equal(unsupported.loads.length, 1); // Never attempts to load a transfer as a sales order.
});
test("native record type mismatches fail closed", () => {
  assert.throws(
    () =>
      harness({ recordType: "transferorder" }).adapter.read("salesorder:101"),
    /type/,
  );
});
test("native quantities cannot coerce booleans, whitespace or locale strings to evidence", () => {
  for (const quantity of [false, " ", "1,000", "10", undefined])
    assert.equal(
      harness({ quantity }).adapter.billing("salesorder:101").lines[0].ordered,
      quantity === undefined ? 10 : null,
    );
});
test("native billing marks capped line evidence as incomplete", () => {
  const h = harness();
  h.rec.getLineCount = () => 101;
  const f = h.adapter.billing("salesorder:101");
  assert.equal(f.lines.length, 100);
  assert.equal(f.complete, false);
  assert.match(f.warnings.join(" "), /100/);
});
test("Suitelet GET uses the documented output object and sanitizes missing bundle errors", () => {
  for (const missing of [false, true]) {
    let output = "";
    const mod = amd(
      "netsuite/FileCabinet/SuiteScripts/RecordExplorer/suitelet.js",
      {
        "N/file": {
          load: () => {
            if (missing) throw Error("private cabinet path");
            return { getContents: () => "<html>workbench</html>" };
          },
        },
        "N/runtime": { getCurrentUser: () => ({ id: 1 }) },
        "./netsuite-adapter": {},
        "./service": {},
        "./account-config": { deploymentValidated: true },
      },
    );
    mod.onRequest({
      request: { method: "GET" },
      response: {
        setHeader() {},
        write: (options) => {
          assert.equal(typeof options.output, "string");
          output = options.output;
        },
      },
    });
    if (missing) {
      assert.ok(JSON.parse(output).error);
      assert.ok(!output.includes("private cabinet"));
    } else assert.equal(output, "<html>workbench</html>");
  }
});
