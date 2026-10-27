# TimeThunder API for a token

Everything is under `<TT_API_URL>/api`. Send `Authorization: Bearer <token>`. `scripts/tt.mjs` does this for you.

Without the repository, send the command and read the answer. A wrong input answers 400 with a message naming the field.

## Conventions

- Money is an integer in satang. 1 baht is 100 satang.
- A date is `YYYY-MM-DD` in the Christian era. `operateYear` is a Buddhist-era year, such as 2568.
- A command answers `{ "ok": true, "result": ... }`. An error answers `{ "ok": false, "message": "..." }` with the message in Thai.
- 401 means the token is missing, wrong or revoked. 403 on a command means it is for staff only. 404 on a command means the name is wrong. 409 means the job or record is in a state that does not allow the command.
- An `Idempotency-Key` header makes a command safe to retry. The same key with the same command returns the first result and writes nothing.

## Reads

`tt.mjs get <path>`

| Path | Answers |
|---|---|
| `/settings`, `/settings/operate-year` | Settings, the current operate year |
| `/jobs` | The job register. Filters: `operateYear` (a year or `all`), `jobNumber`, `customerId`, `businessId`, `intakeBatchId`, `auditorId`, `auditorRole`, `progress` (comma-separated from `notReady`, `readyToStart`, `started`, `readyToReview`, `delivered`, `cancelled`), `flag`, `onHand`, `q` |
| `/jobs/:id` | One job: pricing, auditor queue, `closing`, `missingClosing`, `files`, `notes`, `history` |
| `/jobs/:id/folder-suggestions` | The job's folder state and candidate folders |
| `/ready-check` | Jobs and what each lacks before it can start |
| `/dashboard` | Totals for a year |
| `/customers`, `/customers/:id`, `/customers/:id/money` | Customers, one customer, its receipts |
| `/auditors`, `/auditors/:id`, `/auditors/:id/money` | Auditors, one auditor, its payouts |
| `/businesses`, `/businesses/:id` | Businesses |
| `/intake-batches`, `/intake-batches/:id` | Intake batches and their rows |
| `/dropbox/entries?parentId=` | The file index, one folder at a time. Names only, never contents |
| `/folder-bindings`, `/auditor-folders` | Which folder each job and auditor is bound to |
| `/events?limit=` | The event log, newest first |
| `/uploads/:id` | A stored slip or intake file |
| `/tfac/sync` | The state of the council lookup run |

`/jobs` without `operateYear` answers the current year. With `jobNumber` and no year it searches every year.

## Commands a token can run

`tt.mjs command <name> '<json>'`

- **Jobs.** `setEstimatedRevenue`, `setAgreedFee`, `reapplyJobRates`, `setAuditorQueue`, `setHolderFee`, `handoffJob`, `addDiscount`, `removeDiscount`, `setClosing`, `recordTfacCheck`, `cancelJob`, `restoreJob`, `addNote`, `editNote`, `deleteNote`.
- **Intake.** `editIntakeRow`, `confirmIntakeBatch`, `discardIntakeBatch`, `confirmIntakePrices`.
- **Money.** `addReceipt`, `editReceipt`, `deleteReceipt`, `addPayout`, `editPayout`, `deletePayout`.
- **Customers and rates.** `createCustomer`, `updateCustomer`, `setCustomerArchived`, `setCustomerDeliveryRequirements`, `addCustomerNote`, `editCustomerNote`, `removeCustomerNote`, `setCustomerRateSet`, `customizeCustomerRates`, `resetCustomerRates`, `createRateSet`, `renameRateSet`, `setDefaultRateSet`, `deleteRateSet`, `addRateTier`, `updateRateTier`, `removeRateTier`.
- **Auditors and businesses.** `createAuditor`, `updateAuditor`, `setAuditorArchived`, `renameBusiness`, `addObservationPreset`, `updateObservationPreset`, `removeObservationPreset`.
- **Settings.** `setCurrentOperateYear`, `setJobNumberFloor`.
- **Dropbox.** `setDropboxRootFolder`, `refreshFileIndex`, `bindJobFolder`, `unbindJobFolder`, `setFileTemplate`, `setJobFileRequirement`.

`uploadIntakeFile` and `uploadSlip` take a file as multipart, with parts `input` (JSON) and `file`. `tt.mjs` does not send multipart.

`POST /tfac/sync` starts a council lookup run. It is not a command, and `tt.mjs` does not send it.

## Staff only

A token gets 403 from these. Ask a staff member to do them on the web app: `approveDelivery`, `revokeDeliveryApproval`, `startJobs`, `createStaffUser`, `setStaffPassword`, `createApiToken`, `revokeApiToken`, `stageLegacyRegister`, `confirmAuditorFolders`, `setDropboxAppKey`, `startDropboxConnection`, `completeDropboxConnection`, `disconnectDropbox`.
