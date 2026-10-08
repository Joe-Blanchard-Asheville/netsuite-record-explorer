/** @NApiVersion 2.1 */
define(["N/search", "N/record", "N/url", "N/runtime", "./core"], function (
  search,
  record,
  url,
  runtime,
  core,
) {
  "use strict";
  const TX = [
    "salesorder",
    "purchaseorder",
    "itemfulfillment",
    "itemreceipt",
    "invoice",
  ];
  const TYPE_ENUM = {
    customer: "CUSTOMER",
    vendor: "VENDOR",
    salesorder: "SALES_ORDER",
    purchaseorder: "PURCHASE_ORDER",
    itemfulfillment: "ITEM_FULFILLMENT",
    itemreceipt: "ITEM_RECEIPT",
    invoice: "INVOICE",
  };
  const CHILDREN = {
    salesorder: ["itemfulfillment", "invoice"],
    purchaseorder: ["itemreceipt"],
  };
  const PARENT_TYPES = {
    itemfulfillment: ["salesorder"],
    itemreceipt: ["purchaseorder"],
    invoice: ["salesorder"],
  };
  const checkBudget = () => {
    if (runtime.getCurrentScript().getRemainingUsage() < 150)
      core.fail(
        "BUDGET",
        "Remaining NetSuite usage is below the safety reserve.",
      );
  };
  const string = (v) => (v == null ? "" : String(v));
  function createAdapter(config = {}) {
    const coverage = [
      "Created-from: sales order to fulfillment/invoice; purchase order to receipt",
      "Payment application, custom joins and entity links are not included",
    ];
    // Cache per request only. Never share record data between roles or requests.
    const cache = new Map();
    function load(key) {
      const { type, id } = core.parseKey(key);
      if (!cache.has(key)) {
        checkBudget();
        const rec = record.load({
          type: record.Type[TYPE_ENUM[type]],
          id: Number(id),
          isDynamic: false,
        });
        if (rec.type !== type)
          core.fail(
            "UNSUPPORTED",
            "Loaded record type does not match the requested type.",
          );
        cache.set(key, rec);
      }
      return cache.get(key);
    }
    function read(key) {
      const { type, id } = core.parseKey(key),
        rec = load(key),
        tx = TX.includes(type);
      const get = (fieldId) => rec.getValue({ fieldId });
      const text = (fieldId) => string(rec.getText({ fieldId }));
      // Explicit server-side mapping only, after account validation. No default status assumptions.
      const orderStatus =
        type === "salesorder" ? string(get("orderstatus")) : "";
      const approved =
        config.schemaValidated === true && type === "salesorder"
          ? (config.approvedOrderStatuses || []).includes(orderStatus)
            ? true
            : (config.pendingOrderStatuses || []).includes(orderStatus)
              ? false
              : null
          : null;
      return {
        type,
        id,
        number: string(get(tx ? "tranid" : "entityid")),
        entity: tx
          ? text("entity")
          : string(get("companyname") || get("entityid")),
        memo: string(get(tx ? "memo" : "comments")),
        status: tx
          ? string(get("status"))
          : get("isinactive")
            ? "Inactive"
            : "Active",
        state: "unknown",
        inactive: tx ? false : get("isinactive") === true,
        approved,
        revision: string(get("lastmodifieddate")),
        url: url.resolveRecord({
          recordType: type,
          recordId: id,
          isEditMode: false,
        }),
      };
    }
    function searchRecords(input) {
      const p = core.validatePlan(input),
        rows = [],
        warnings = [];
      if (p.status !== "any" || p.overdue)
        core.fail(
          "UNSUPPORTED",
          "Live status and overdue-receipt filters need account-specific mapping. Use Any status without Overdue.",
        );
      for (const type of p.types.slice().sort()) {
        const tx = TX.includes(type);
        try {
          checkBudget();
          const filters = tx
            ? [["mainline", "is", "T"]]
            : p.includeInactive
              ? []
              : [["isinactive", "is", "F"]];
          if (p.query) {
            const op =
              p.match === "exact"
                ? search.Operator.IS
                : search.Operator.CONTAINS;
            const terms = p.fields.map((f) =>
              f === "entity"
                ? search.createFilter({
                    name: "formulatext",
                    formula: tx ? "{entity}" : "NVL({companyname}, {entityid})",
                    operator: op,
                    values: p.query,
                  })
                : search.createFilter({
                    name:
                      f === "number"
                        ? tx
                          ? "tranid"
                          : "entityid"
                        : tx
                          ? "memo"
                          : "comments",
                    operator: op,
                    values: p.query,
                  }),
            );
            const or = terms.flatMap((term, i) => (i ? ["OR", term] : [term]));
            if (filters.length) filters.push("AND");
            filters.push(or);
          }
          const columns = [
            search.createColumn({ name: "internalid", sort: search.Sort.ASC }),
            tx ? "tranid" : "entityid",
            tx ? "entity" : "companyname",
            tx ? "memo" : "comments",
            ...(tx ? ["statusref"] : ["isinactive"]),
          ];
          const paged = search
            .create({ type: search.Type[TYPE_ENUM[type]], filters, columns })
            .runPaged({ pageSize: 200 });
          if (paged.count > 200)
            warnings.push(
              `${type}: only the first 200 matching records were inspected. Narrow the search.`,
            );
          if (!paged.count) continue;
          for (const result of paged.fetch({ index: 0 }).data) {
            const get = (name) => string(result.getValue({ name }));
            const r = {
              type,
              id: String(result.id),
              number: get(tx ? "tranid" : "entityid"),
              entity: tx
                ? string(result.getText({ name: "entity" }))
                : get("companyname") || get("entityid"),
              memo: get(tx ? "memo" : "comments"),
              status: tx
                ? string(result.getText({ name: "statusref" }))
                : result.getValue({ name: "isinactive" })
                  ? "Inactive"
                  : "Active",
              state: "unknown",
              inactive: !tx && result.getValue({ name: "isinactive" }) === true,
              url: url.resolveRecord({
                recordType: type,
                recordId: result.id,
                isEditMode: false,
              }),
            };
            rows.push({
              ...r,
              reasons: [
                "Matched NetSuite query on selected fields",
                ...core.reasons(r, p),
              ],
            });
          }
        } catch (_) {
          warnings.push(
            `${type}: source unavailable, query unsupported, or usage limit reached.`,
          );
        }
      }
      return {
        rows: rows.slice(p.page * p.pageSize, (p.page + 1) * p.pageSize),
        total: rows.length,
        page: p.page,
        pageSize: p.pageSize,
        partial: warnings.length > 0,
        warnings,
      };
    }
    function neighbors(key) {
      const { type, id } = core.parseKey(key),
        rec = load(key),
        edges = [],
        warnings = [];
      if (PARENT_TYPES[type]) {
        const parent = rec.getValue({ fieldId: "createdfrom" });
        if (parent) {
          try {
            checkBudget();
            const found = search
              .create({
                type: search.Type.TRANSACTION,
                filters: [
                  ["internalid", "anyof", String(parent)],
                  "AND",
                  ["mainline", "is", "T"],
                ],
                columns: ["internalid"],
              })
              .run()
              .getRange({ start: 0, end: 2 });
            if (
              found.length !== 1 ||
              !PARENT_TYPES[type].includes(found[0].recordType)
            )
              core.fail(
                "UNSUPPORTED",
                "Parent type is unavailable or outside coverage.",
              );
            const parentKey = `${found[0].recordType}:${parent}`;
            read(parentKey);
            edges.push({
              from: parentKey,
              to: key,
              kind: "created from",
              evidence: `${key}.createdfrom = ${parent}; type resolved by transaction search`,
            });
          } catch (_) {
            warnings.push(
              "Created-from record is inaccessible or outside the configured parent types.",
            );
          }
        }
      }
      for (const childType of CHILDREN[type] || []) {
        try {
          checkBudget();
          const results = search
            .create({
              type: search.Type[TYPE_ENUM[childType]],
              filters: [
                ["mainline", "is", "T"],
                "AND",
                ["createdfrom", "anyof", id],
              ],
              columns: [
                search.createColumn({
                  name: "internalid",
                  sort: search.Sort.ASC,
                }),
              ],
            })
            .runPaged({ pageSize: 80 });
          if (results.count > 80)
            warnings.push("Relationship source exceeded the 80-record cap.");
          if (results.count)
            for (const r of results.fetch({ index: 0 }).data)
              edges.push({
                from: key,
                to: `${childType}:${r.id}`,
                kind: "created from",
                evidence: `${childType}:${r.id}.createdfrom = ${id}`,
              });
        } catch (_) {
          warnings.push(`${childType}: relationship source unavailable.`);
        }
      }
      return { edges, warnings };
    }
    function billing(key) {
      if (core.parseKey(key).type !== "salesorder")
        core.fail("INVALID_INPUT", "Expected a sales order.");
      const rec = load(key),
        count = rec.getLineCount({ sublistId: "item" }),
        lines = [];
      // Quantity totals plus one account-wide boolean cannot prove line-level billing policy.
      // Keep live conclusions disabled until the policy adapter and account matrix are implemented.
      const warnings = [
        "Live line-level billing policy is not implemented. Quantities are evidence only; no billing cause is asserted.",
      ];
      if (
        config.schemaValidated !== true ||
        typeof config.requiresFulfillment !== "boolean"
      )
        warnings.push(
          "Approval and billing-policy mapping has not been validated for this account.",
        );
      if (count > 100)
        warnings.push("Only the first 100 item lines were inspected.");
      for (let line = 0; line < Math.min(count, 100); line++) {
        const num = (fieldId) => {
          const v = rec.getSublistValue({ sublistId: "item", fieldId, line });
          return typeof v === "number" && Number.isFinite(v) ? v : null;
        };
        lines.push({
          line: line + 1,
          ordered: num("quantity"),
          fulfilled: num("quantityfulfilled"),
          billed: num("quantitybilled"),
        });
      }
      return {
        lines,
        complete: warnings.length === 0,
        requiresFulfillment: config.requiresFulfillment,
        revision: read(key).revision,
        warnings,
      };
    }
    return {
      mode: "netsuite",
      coverage,
      read,
      search: searchRecords,
      neighbors,
      billing,
      meta: () => ({
        mode: "netsuite",
        samples: [],
        today: new Date().toISOString().slice(0, 10),
        coverage,
        limitations: [
          "Status and overdue filters require account mapping",
          "Live investigation is evidence-only until line-level policy support is implemented and validated",
          "Access follows the Suitelet execution role; verify deployment permissions",
          "No live mutations",
        ],
      }),
    };
  }
  return { createAdapter };
});
