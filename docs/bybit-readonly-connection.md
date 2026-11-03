# Bybit connection (read-only stage)

The application defaults to Bybit Testnet. To select the production API for account/balance reads only, set:

- `BYBIT_ENV=mainnet`
- `BYBIT_API_KEY`: API key stored as a Render secret
- `BYBIT_SECRET_KEY`: API secret stored as a Render secret
- `MAXINCOME_READ_TOKEN`: a separate long random token used as a Bearer token for `GET /api/balance`

For Testnet, use `BYBIT_ENV=testnet` (the default).

The balance endpoint returns HTTP 401 unless `Authorization: Bearer <MAXINCOME_READ_TOKEN>` is supplied. Never put API credentials or the read token in source control, browser code, or chat.

This stage does not submit orders. The service health response reports `orderExecutionEnabled: false`; trading remains PAPER. Do not enable production trading until persistent risk controls, order lifecycle handling, reconciliation, and integration tests are implemented and reviewed.
