# Flags service

Per-user feature rollout. Rules live in the flags console; the client evaluates them locally.

## Naming

Flags are kebab-case and name the feature, not the team: `product-reviews`, `express-shipping`, `new-search`.

## Rollout

Start with an allowlist of internal users, then percentages: 1%, 10%, 50%, 100%. A flag at 100% for two weeks should be removed from code.

## Kill switch

Setting percent to 0 and clearing the allowlist turns a feature off within 30 seconds, without a deploy.

## Environment variables vs flags

Environment variables are for process-wide settings that change with a deploy (currency, thresholds). Anything that should differ per user, or be turned off without a deploy, is a flag.

## Testing

Pass `createFlags({ "my-flag": { users: ["u1"] } })` in tests; never read the real service from a unit test.

## Existing flags

| Flag | Owner | Rollout |
| --- | --- | --- |
| `promo-5d08` | team-core | 10% |
| `pay-a455` | team-growth | 50% |
| `pay-b7fc` | team-growth | 50% |
| `promo-a8db` | team-core | 10% |
| `reviews-033c` | team-growth | allowlist |
| `cart-acd3` | team-growth | 50% |
| `cart-417b` | team-web | 10% |
| `pay-ae40` | team-web | 10% |
| `account-bea6` | team-core | allowlist |
| `account-847d` | team-web | 50% |
| `cart-42cc` | team-core | 0% |
| `account-bc31` | team-web | 0% |
| `account-c53a` | team-growth | 10% |
| `search-d88a` | team-core | 0% |
| `promo-b13c` | team-growth | 50% |
| `cart-3ad6` | team-payments | 100% (remove) |
| `pay-100f` | team-web | 10% |
| `promo-cbb5` | team-core | 1% |
| `search-c966` | team-web | 0% |
| `reviews-9d2c` | team-web | allowlist |
| `promo-0f32` | team-payments | allowlist |
| `cart-bf2e` | team-core | 100% (remove) |
| `promo-e672` | team-growth | 0% |
| `reviews-6b43` | team-core | 0% |
| `account-0c1b` | team-web | 1% |
| `reviews-6a24` | team-payments | 100% (remove) |
| `promo-d1d2` | team-payments | 50% |
| `search-83b9` | team-core | 1% |
| `search-5609` | team-web | 50% |
| `cart-a224` | team-core | 100% (remove) |
| `pay-2e38` | team-core | 1% |
| `pay-3720` | team-core | 1% |
| `promo-2683` | team-web | 10% |
| `promo-7792` | team-web | 50% |
| `reviews-c314` | team-growth | 0% |
| `cart-ade2` | team-web | 1% |
| `account-4360` | team-growth | 0% |
| `promo-b035` | team-web | 10% |
| `reviews-8f3f` | team-web | allowlist |
| `pay-47a6` | team-payments | allowlist |
| `account-4652` | team-payments | 10% |
| `cart-5b6c` | team-payments | 100% (remove) |
| `promo-3a07` | team-core | 100% (remove) |
| `cart-fb8c` | team-payments | allowlist |
| `promo-3427` | team-payments | 0% |
| `account-c1c0` | team-web | 10% |
| `cart-692c` | team-payments | allowlist |
| `promo-4018` | team-payments | allowlist |
| `account-2d85` | team-web | 50% |
| `cart-173b` | team-core | 0% |
| `account-0f05` | team-payments | 1% |
| `promo-92dd` | team-core | 0% |
| `pay-a600` | team-core | 100% (remove) |
| `promo-a5ed` | team-web | 0% |
| `account-9efd` | team-core | 10% |
| `pay-abb3` | team-web | 100% (remove) |
| `account-6a39` | team-payments | 1% |
| `search-1226` | team-payments | 10% |
| `cart-48c0` | team-growth | 10% |
| `account-c7d0` | team-payments | 1% |
