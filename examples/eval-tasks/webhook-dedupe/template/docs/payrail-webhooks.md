# PayRail webhooks: integration guide

## Overview

PayRail sends an HTTPS POST to your endpoint for every event on your account. Payloads are JSON. Respond with any 2xx status within 10 seconds to acknowledge.

## Event types

- `payment.authorized`: funds reserved, not yet captured
- `payment.captured`: funds captured; amount in minor units
- `payment.failed`: authorization or capture failed; see `data.reason`
- `refund.created`: refund initiated; may still fail
- `refund.succeeded`: refund completed
- `dispute.opened`: cardholder opened a dispute
- `dispute.closed`: dispute resolved; see `data.outcome`
- `payout.paid`: payout sent to your bank
- `customer.updated`: stored customer details changed

## Signatures

Every request carries `PayRail-Signature: t=<unix>,v1=<hex>`. Compute HMAC-SHA256 over `<t>.<raw body>` with your endpoint secret and compare in constant time. Reject timestamps older than 5 minutes.

## Headers

| Header | Meaning |
| --- | --- |
| `PayRail-Signature` | See Signatures. |
| `X-Request-Id` | Unique per HTTP attempt. Quote it in support tickets. |
| `X-Delivery-Id` | Identifies the event delivery. **Identical on every retry of the same delivery.** |
| `X-Event-Version` | Payload schema version, currently `2025-10-01`. |
| `User-Agent` | `PayRail-Webhooks/3.2` |

### Example: `payment.captured`

```json
{
  "id": "evt_122583d833a9",
  "type": "payment.captured",
  "data": { "paymentId": "pay_e05e85d8b3", "amount": 69308, "currency": "usd", "occurredAt": "2026-09-04T21:29:00Z" }
}
```

### Example: `payment.failed`

```json
{
  "id": "evt_d8b1bc731dd6",
  "type": "payment.failed",
  "data": { "paymentId": "pay_4971a1f3d7", "amount": 6589, "currency": "usd", "occurredAt": "2026-09-03T13:04:00Z" }
}
```

### Example: `refund.created`

```json
{
  "id": "evt_93c18b2de38c",
  "type": "refund.created",
  "data": { "paymentId": "pay_b8ee00fefa", "amount": 85064, "currency": "usd", "occurredAt": "2026-09-14T18:36:00Z" }
}
```

### Example: `refund.succeeded`

```json
{
  "id": "evt_116ff86e1362",
  "type": "refund.succeeded",
  "data": { "paymentId": "pay_6d9e90f4e9", "amount": 66317, "currency": "usd", "occurredAt": "2026-09-14T02:00:00Z" }
}
```

### Example: `dispute.opened`

```json
{
  "id": "evt_23205c63ca78",
  "type": "dispute.opened",
  "data": { "paymentId": "pay_0c39906b93", "amount": 42554, "currency": "usd", "occurredAt": "2026-09-12T16:10:00Z" }
}
```

### Example: `dispute.closed`

```json
{
  "id": "evt_6f98f13242d1",
  "type": "dispute.closed",
  "data": { "paymentId": "pay_900ac5106d", "amount": 35831, "currency": "usd", "occurredAt": "2026-09-07T15:09:00Z" }
}
```

### Example: `payout.paid`

```json
{
  "id": "evt_886436894cb6",
  "type": "payout.paid",
  "data": { "paymentId": "pay_e00c5c7e35", "amount": 58960, "currency": "usd", "occurredAt": "2026-09-04T17:41:00Z" }
}
```

### Example: `customer.updated`

```json
{
  "id": "evt_889300a6579d",
  "type": "customer.updated",
  "data": { "paymentId": "pay_7aa608af49", "amount": 11660, "currency": "usd", "occurredAt": "2026-09-15T20:08:00Z" }
}
```

### Example: `payment.captured`

```json
{
  "id": "evt_b38a575448a1",
  "type": "payment.captured",
  "data": { "paymentId": "pay_32078a385f", "amount": 19672, "currency": "usd", "occurredAt": "2026-09-03T18:10:00Z" }
}
```

### Example: `payment.failed`

```json
{
  "id": "evt_7d7ea861da6d",
  "type": "payment.failed",
  "data": { "paymentId": "pay_f249dd8530", "amount": 3511, "currency": "usd", "occurredAt": "2026-09-19T05:34:00Z" }
}
```

### Example: `refund.created`

```json
{
  "id": "evt_96a5e0cc8131",
  "type": "refund.created",
  "data": { "paymentId": "pay_6c22e10c4e", "amount": 14774, "currency": "usd", "occurredAt": "2026-09-06T13:37:00Z" }
}
```

### Example: `refund.succeeded`

```json
{
  "id": "evt_b6f6022c09d8",
  "type": "refund.succeeded",
  "data": { "paymentId": "pay_2246ffff5c", "amount": 73946, "currency": "usd", "occurredAt": "2026-09-02T07:48:00Z" }
}
```

### Example: `dispute.opened`

```json
{
  "id": "evt_cd7b2bf193ba",
  "type": "dispute.opened",
  "data": { "paymentId": "pay_a172458631", "amount": 8942, "currency": "usd", "occurredAt": "2026-09-07T02:19:00Z" }
}
```

### Example: `dispute.closed`

```json
{
  "id": "evt_6f400beb2994",
  "type": "dispute.closed",
  "data": { "paymentId": "pay_78d24a7671", "amount": 57695, "currency": "usd", "occurredAt": "2026-09-19T22:31:00Z" }
}
```

### Example: `payout.paid`

```json
{
  "id": "evt_8f3a8ccb322f",
  "type": "payout.paid",
  "data": { "paymentId": "pay_85071d5f76", "amount": 77661, "currency": "usd", "occurredAt": "2026-09-15T07:21:00Z" }
}
```

### Example: `customer.updated`

```json
{
  "id": "evt_f9305f4cfbc8",
  "type": "customer.updated",
  "data": { "paymentId": "pay_23f7a66166", "amount": 58700, "currency": "usd", "occurredAt": "2026-09-20T19:35:00Z" }
}
```

## Retries

If your endpoint does not return 2xx within 10 seconds, or the connection fails, PayRail retries with exponential backoff: after 1 min, 5 min, 30 min, 2 h, 6 h, and 12 h, for up to 24 hours in total. A delivery can therefore arrive more than once, including concurrently at different instances of your service. Deduplicate on `X-Delivery-Id`. Do not deduplicate on the event body: two different deliveries can legitimately carry identical payloads (for example, two partial captures of the same amount).

## Ordering

Deliveries are not guaranteed to arrive in order. Use `data.occurredAt` to order events for the same object.

## Testing

Use `payrail trigger payment.captured --endpoint <url>` to send a signed test delivery. Test deliveries have `X-Delivery-Id` values prefixed with `test_`.

## Rate limits

PayRail sends at most 50 concurrent deliveries per endpoint. If you return 429, PayRail backs off as for any other failure.

## Changelog

- 2026-05-02: `payout.paid` now includes `data.arrivalDate`
- 2025-10-01: schema version `2025-10-01`: amounts in minor units everywhere
- 2025-03-14: added `X-Delivery-Id`; previously only `X-Request-Id` was sent
- 2024-11-20: retry window extended from 6 h to 24 h
