/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
  "N/file",
  "N/runtime",
  "./netsuite-adapter",
  "./service",
  "./account-config",
], function (file, runtime, adapter, service, config) {
  "use strict";
  function onRequest(context) {
    const { request, response } = context;
    response.setHeader({ name: "Cache-Control", value: "no-store" });
    response.setHeader({ name: "X-Content-Type-Options", value: "nosniff" });
    const userId = Number(runtime.getCurrentUser().id);
    const writeJSON = (data) => {
      response.setHeader({ name: "Content-Type", value: "application/json" });
      response.write({ output: JSON.stringify(data) });
    };
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      response.setHeader({ name: "Content-Type", value: "application/json" });
      writeJSON({ error: "Authentication required." });
      return;
    }
    try {
      if (config.deploymentValidated !== true) {
        writeJSON({
          error:
            "Deployment permission review is required before account access. See docs/SANDBOX.md.",
        });
        return;
      }
      if (request.method === "GET") {
        response.setHeader({
          name: "Content-Type",
          value: "text/html; charset=utf-8",
        });
        response.write({
          output: file
            .load({ id: "/SuiteScripts/RecordExplorer/index.html" })
            .getContents(),
        });
        return;
      }
      if (
        request.method !== "POST" ||
        !request.body ||
        request.body.length > 65536
      )
        throw new Error("Invalid request.");
      const body = JSON.parse(request.body);
      if (!["meta", "read", "graph"].includes(body.action))
        throw new Error("Unsupported action.");
      const result = service
        .createService(adapter.createAdapter(config))
        .route(body);
      writeJSON({ data: result });
    } catch (e) {
      writeJSON({
        error:
          e.code === "INVALID_INPUT" || e.code === "UNSUPPORTED"
            ? e.message
            : "Record or source unavailable under this role. No changes were made.",
      });
    }
  }
  return { onRequest };
});
