# Zoho Books rollout

The integration defaults to `ZOHO_BOOKS_MODE=disabled`. Booking and payment writes are always committed before document processing; a Zoho or Resend failure never reverses a seat or payment.

## Before draft mode

- Configure the Zoho Books organization, invoice/retainer sequences, logo, PDF templates, and a service item that is explicitly non-taxable.
- Confirm that both the item and document templates show the advertised trip price unchanged, with no tax line or tax amount. The worker rejects a document if Zoho reports any applied tax.
- Create an OAuth client with the contact, invoice, retainer-invoice, and customer-payment scopes needed by the API.
- Set the `ZOHO_*` secrets shown in `.env.example`; never put them in site YAML.
- Schedule an authenticated `POST /api/jobs/zoho-documents` call with `Authorization: Bearer $ZOHO_JOB_SECRET`. The worker claims at most ten jobs per call and retries failed work with backoff.

## Draft verification

Set `ZOHO_BOOKS_MODE=draft`. Draft mode creates Zoho customers and draft documents but records no Zoho payments and sends no customer financial email.

Reconcile at least these samples:

- traveler with only the required name, email, phone, city, and state;
- traveler in another state;
- advance followed by balance payment and a zero-balance final invoice.

Use the registration card to inspect the Zoho number/status, open the record in Zoho, refresh status, and retry failures.

## Live mode

Enable `ZOHO_BOOKS_MODE=live` only after the draft samples, numbering, non-taxable item, templates, and attachment email have been approved. Live mode records the retainer payment, applies it to the final invoice, records only the balance, verifies both zero tax and zero balance, downloads the PDF, and sends it through Resend.

After three failed attempts the traveler receives a confirmation without the PDF; the document stays retryable and is emailed after recovery. Corrections, refunds, voids, and credit notes remain Zoho-only. Use **Refresh** in STT to surface the current Zoho status.

Historical registrations are not backfilled automatically. Use the reviewed per-registration **Generate document** action only after confirming the stored payment and traveler details.
