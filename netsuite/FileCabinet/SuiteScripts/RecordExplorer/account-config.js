/** @NApiVersion 2.1 */
define([], function () {
  // Leave fail-closed until representative account records and roles are validated.
  // These are orderstatus values, not labels. Obtain the actual account values.
  // deploymentValidated is a manual review gate, not runtime proof of Execute As Role.
  // For controlled sandbox validation, review deployment settings before enabling this local copy.
  // Restricted-role tests and recorded results are required before any wider release.
  return {
    deploymentValidated: false,
    schemaValidated: false,
    approvedOrderStatuses: [],
    pendingOrderStatuses: [],
    requiresFulfillment: null,
  };
});
