# Sandbox setup

Owner of account testing: Joe Blanchard. **No native test results are recorded yet.**

## Prerequisites

- An authorized NetSuite sandbox with server-side SuiteScript enabled and permission to upload files and create script/deployment records.
- An appropriate deployer and at least one restricted test role. Use known synthetic transactions; do not copy customer data into this repository.
- Record the account release and enabled features, especially OneWorld, shipping, billing and approval customizations relevant to the test.

## Build and install

1. Run `npm ci`, `npm test`, `npm run check`, and `npm run build`.
2. Upload all six files from `dist/FileCabinet/SuiteScripts/RecordExplorer/` into `/SuiteScripts/RecordExplorer/`. Preserve filenames and relative paths. Files are `suitelet.js`, `account-config.js`, `core.js`, `service.js`, `netsuite-adapter.js`, and `index.html`.
3. Create a Suitelet script record for `suitelet.js`. Create an internal deployment in **Testing** status. Set **Execute As Role** to **Current User**, limit the audience, and leave **Available Without Login** unchecked. Do not make File Cabinet resources public.
4. The initial internal URL returns the permission-review gate. After checking the deployment settings, set `deploymentValidated: true` only in the sandbox copy of `account-config.js` to permit the controlled tests. This flag is an acknowledgment, not proof of permissions. Keep distributed defaults false.
5. Open the internal Suitelet URL as the validating user. It must say **NETSUITE / READ ONLY** and show no fictional samples. Enter a real sandbox record type and ID where required.
6. Keep `schemaValidated: false` until actual status mappings and representative cases have been checked. Do not guess approval codes. Native billing diagnosis remains disabled even after mapping approval status.

The current build uses manual File Cabinet deployment. SDF packaging is future work. Each tool has a separate File Cabinet folder so the three installations do not overwrite one another.

## Acceptance matrix

Record expected and observed results in [SANDBOX-RESULTS.md](SANDBOX-RESULTS.md), including the commit and role. A mock test is not an account result.

| Case                             | Expected outcome                                      |
| -------------------------------- | ----------------------------------------------------- |
| Authenticated permitted role     | UI and supported reads work under that role           |
| Restricted role and subsidiary   | Hidden records cannot be read by supplying a known ID |
| Anonymous or public URL          | No account access                                     |
| Unsupported type or malformed ID | Rejected without private exception details            |
| Deleted or denied source         | Clear failure or partial-data warning                 |
| Native record links              | Correct record in the same account, view mode         |
| Usage near reserve               | Controlled stop and explicit incomplete result        |
| Missing bundle/file              | Sanitized error, no private path disclosure           |

| SO with split fulfillments and invoices | Supported edges reconcile with source records |
| PO with split receipts | All inspected receipt links match native records |
| Transfer/vendor-return/return-authorization parent | Excluded with a coverage warning, never guessed as an SO/PO |
| Hidden related record | Omitted with a warning, no record details leaked |
| Deep graph or more than 80 children | Limits produce explicit partial-state warnings |
| Zoom, pan and keyboard inspection | UI remains usable in the real Suitelet |

Measure native response time and remaining governance units on declared test cases. Do not extrapolate fixture timings to account performance.

## Rollback and signoff

Keep the previous deployed files/configuration before replacing them. To stop testing, disable the deployment. Verify the internal URL no longer runs, restore the previous files if needed, and record the rollback result. Revoke the test audience when testing is finished.

Before a wider release, resolve relevant high-impact findings, complete permitted/restricted-role testing, link sanitized evidence to the tested commit, and have another authorized reviewer confirm deployment permissions.

## Oracle references

- [Suitelet deployment fields](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_1524082857.html)
- [Execute As Role](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2997500.html)
- [ServerResponse.write](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4567651956.html)
- [Search.runPaged](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4486596158.html)
- [record.load](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4267258486.html)

API references establish platform contracts; they do not prove behavior in this sandbox.
