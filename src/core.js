(function (factory) {
  if (typeof define === "function") define([], factory);
  else if (typeof module !== "undefined") module.exports = factory();
})(function () {
  "use strict";
  const TYPES = [
    "customer",
    "vendor",
    "salesorder",
    "purchaseorder",
    "itemfulfillment",
    "itemreceipt",
    "invoice",
  ];
  const FIELDS = ["number", "entity", "memo"];
  const keyOf = (r) => `${r.type}:${r.id}`;
  const fail = (code, message) => {
    const e = new Error(message);
    e.code = code;
    throw e;
  };
  const integer = (n, min, max, label) => {
    if (!Number.isInteger(n) || n < min || n > max)
      fail("INVALID_INPUT", `${label} must be ${min} to ${max}.`);
    return n;
  };
  function parseKey(key) {
    if (typeof key !== "string" || !/^[a-z]+:[1-9][0-9]{0,14}$/.test(key))
      fail("INVALID_INPUT", "Use a record type and numeric ID.");
    const [type, id] = key.split(":");
    if (!TYPES.includes(type))
      fail("INVALID_INPUT", "Unsupported record type.");
    return { type, id };
  }
  function validatePlan(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      fail("INVALID_INPUT", "Search plan required.");
    const permitted = [
      "types",
      "fields",
      "query",
      "match",
      "includeInactive",
      "status",
      "overdue",
      "page",
      "pageSize",
    ];
    if (Object.keys(input).some((k) => !permitted.includes(k)))
      fail("INVALID_INPUT", "Unknown search option.");
    const list = (v, options, name) => {
      if (
        !Array.isArray(v) ||
        !v.length ||
        v.length > options.length ||
        v.some((x) => !options.includes(x))
      )
        fail("INVALID_INPUT", `Select valid ${name}.`);
      return [...new Set(v)];
    };
    const p = {
      types: list(input.types, TYPES, "record types"),
      fields: list(input.fields || FIELDS, FIELDS, "search fields"),
      query: input.query ?? "",
      match: input.match ?? "contains",
      includeInactive: input.includeInactive ?? false,
      status: input.status ?? "any",
      overdue: input.overdue ?? false,
      page: input.page ?? 0,
      pageSize: input.pageSize ?? 10,
    };
    if (typeof p.query !== "string" || p.query.length > 120)
      fail("INVALID_INPUT", "Search text must be at most 120 characters.");
    p.query = p.query.trim();
    if (!["contains", "exact"].includes(p.match))
      fail("INVALID_INPUT", "Unsupported match operator.");
    if (!["any", "open", "closed"].includes(p.status))
      fail("INVALID_INPUT", "Unsupported status filter.");
    if (
      typeof p.includeInactive !== "boolean" ||
      typeof p.overdue !== "boolean"
    )
      fail("INVALID_INPUT", "Filters must be boolean.");
    if (p.overdue && p.types.some((t) => t !== "purchaseorder"))
      fail(
        "INVALID_INPUT",
        "Overdue receipt filter supports purchase orders only.",
      );
    integer(p.page, 0, 999, "Page");
    integer(p.pageSize, 1, 50, "Page size");
    return p;
  }
  function matches(record, plan, today) {
    if (
      !plan.types.includes(record.type) ||
      (!plan.includeInactive && record.inactive)
    )
      return false;
    if (plan.status !== "any" && record.state !== plan.status) return false;
    if (
      plan.overdue &&
      !(
        record.expectedDate &&
        record.expectedDate < today &&
        record.quantity > record.receivedQuantity &&
        record.state === "open"
      )
    )
      return false;
    const q = plan.query.toLowerCase();
    return (
      !q ||
      plan.fields.some((f) =>
        plan.match === "exact"
          ? String(record[f] || "").toLowerCase() === q
          : String(record[f] || "")
              .toLowerCase()
              .includes(q),
      )
    );
  }
  function reasons(record, plan) {
    if (!plan.query) return ["Included by selected record type and filters"];
    const q = plan.query.toLowerCase();
    return plan.fields
      .filter((f) =>
        plan.match === "exact"
          ? String(record[f] || "").toLowerCase() === q
          : String(record[f] || "")
              .toLowerCase()
              .includes(q),
      )
      .map((f) => `${f}: ${plan.match} match`);
  }
  function graph(adapter, root, options = {}) {
    parseKey(root);
    if (
      !options ||
      typeof options !== "object" ||
      Array.isArray(options) ||
      Object.keys(options).some((k) => !["depth", "cap"].includes(k))
    )
      fail("INVALID_INPUT", "Use depth and cap graph options only.");
    const depth = integer(options.depth ?? 3, 0, 5, "Depth");
    const cap = integer(options.cap ?? 40, 1, 80, "Node cap");
    const start = adapter.read(root); // Root denial is a hard error, not an empty graph.
    const nodes = new Map([[root, { ...start, depth: 0 }]]),
      edges = new Map(),
      warnings = new Set();
    const queue = [[root, 0]],
      visited = new Set();
    while (queue.length) {
      const [key, level] = queue.shift();
      if (visited.has(key)) continue;
      visited.add(key);
      if (level >= depth) {
        warnings.add(
          "Depth limit reached; further relationships were not checked.",
        );
        continue;
      }
      let response;
      try {
        response = adapter.neighbors(key);
      } catch (_) {
        warnings.add("A relationship source failed or was not accessible.");
        continue;
      }
      for (const w of response.warnings || []) warnings.add(w);
      for (const edge of response.edges) {
        if (edge.from !== key && edge.to !== key) continue;
        const target = edge.from === key ? edge.to : edge.from;
        if (!nodes.has(target)) {
          if (nodes.size >= cap) {
            warnings.add(
              "Node limit reached; additional records were omitted.",
            );
            continue;
          }
          try {
            parseKey(target);
            nodes.set(target, { ...adapter.read(target), depth: level + 1 });
          } catch (_) {
            warnings.add(
              "A related record is unavailable under this role or no longer exists.",
            );
            continue;
          }
          queue.push([target, level + 1]);
        }
        edges.set(`${edge.from}|${edge.to}|${edge.kind}`, edge);
      }
    }
    return {
      root,
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      warnings: [...warnings],
      partial: warnings.size > 0,
      coverage: adapter.coverage,
      scope:
        "Configured relationships visible to this role; not a complete business-history assertion.",
    };
  }
  function diagnose(order, facts) {
    facts = facts && typeof facts === "object" ? facts : {};
    const evidence = [
      {
        source: keyOf(order),
        field: "approved",
        value: order.approved,
        revision: order.revision,
      },
      {
        source: keyOf(order),
        field: "billing lines",
        value: facts.lines,
        revision: facts.revision,
      },
    ];
    const result = {
      decision: "escalate",
      title: "More evidence needed",
      findings: [],
      evidence,
      action: null,
      mode: "rules",
    };
    if (
      facts.complete !== true ||
      !Array.isArray(facts.lines) ||
      !Array.isArray(facts.warnings) ||
      facts.warnings.length ||
      typeof order.approved !== "boolean" ||
      !facts.revision ||
      facts.revision !== order.revision
    ) {
      result.findings.push(
        ...(Array.isArray(facts.warnings) ? facts.warnings : []),
        "Approval or billing evidence is incomplete. No safe cause is asserted.",
      );
      return result;
    }
    if (
      !facts.lines.length ||
      facts.lines.some(
        (l) =>
          !l ||
          [l.ordered, l.fulfilled, l.billed].some(
            (n) => !Number.isFinite(n) || n < 0,
          ) ||
          l.fulfilled > l.ordered ||
          l.billed > l.ordered,
      )
    ) {
      result.findings.push(
        "Quantities are missing or contradictory. Review the source transaction.",
      );
      return result;
    }
    const ordered = facts.lines.reduce((n, l) => n + l.ordered, 0),
      billed = facts.lines.reduce((n, l) => n + l.billed, 0);
    if (
      !Number.isFinite(ordered) ||
      !Number.isFinite(billed) ||
      ordered === 0
    ) {
      result.findings.push(
        "Positive, finite quantity evidence is required. Zero-quantity or amount-based billing needs separate policy.",
      );
      return result;
    }
    if (ordered > 0 && billed >= ordered) {
      result.decision = "resolved";
      result.title = "This order is fully billed";
      result.findings.push(
        "Every inspected line is billed to its ordered quantity.",
      );
      return result;
    }
    if (order.approved === false) {
      result.decision = "supported";
      result.title = "An approval hold needs review";
      result.findings.push(
        "The order is not approved and still has unbilled quantities. Approval routing must be reviewed by an authorized owner.",
      );
      result.action = {
        kind: "request_approval_review",
        label: "Request approval review",
        key: keyOf(order),
        revision: order.revision,
        factsRevision: facts.revision,
      };
      return result;
    }
    if (facts.requiresFulfillment !== true) {
      result.findings.push(
        "Billing policy or fulfillment requirements are not verified.",
      );
      return result;
    }
    if (facts.lines.every((l) => l.fulfilled <= l.billed)) {
      result.decision = "supported";
      result.title = "No additional fulfilled quantity is ready";
      result.findings.push(
        "No inspected line has fulfilled quantity above billed quantity. Check outstanding fulfillment.",
      );
      return result;
    }
    result.findings.push(
      "Fulfilled, unbilled quantity exists. Billing schedules, holds, periods and account workflows still require review.",
    );
    return result;
  }
  function investigate(adapter, key) {
    if (parseKey(key).type !== "salesorder")
      fail("INVALID_INPUT", "Investigation currently supports sales orders.");
    const order = adapter.read(key);
    let facts;
    try {
      facts = adapter.billing(key);
    } catch (_) {
      facts = {
        lines: [],
        complete: false,
        warnings: ["Billing evidence could not be read."],
      };
    }
    const result = diagnose(order, facts);
    result.trace = [
      { tool: "read_order", source: key },
      { tool: "read_billing", source: key },
    ];
    result.warnings = facts.warnings || [];
    return result;
  }
  return {
    TYPES,
    FIELDS,
    keyOf,
    fail,
    integer,
    parseKey,
    validatePlan,
    matches,
    reasons,
    graph,
    diagnose,
    investigate,
  };
});
