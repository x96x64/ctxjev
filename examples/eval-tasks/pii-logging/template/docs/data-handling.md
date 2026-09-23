# Data handling policy (excerpt)

## Scope

Applies to every service that writes to the general log pipeline (stdout, collected and retained 400 days).

## Personal data in logs

Personal data must not appear in general logs in a form that identifies a person. Where the value helps debugging, mask it rather than removing the field, so the shape of the payload stays visible.

## Audit trail

The audit trail is exempt: it stores raw identifiers in the encrypted audit store under legal hold.

## Retention

General logs: 400 days. Audit store: 7 years.

## Field inventory

| Service | Field | Class |
| --- | --- | --- |
| shop-api | `order.createdAt` | personal |
| shop-api | `order.email` | public |
| shop-api | `user.name` | personal |
| search | `session.createdAt` | internal |
| billing | `user.phone` | personal |
| billing | `profile.ip` | public |
| billing | `order.createdAt` | internal |
| billing | `order.ip` | public |
| search | `order.id` | public |
| shop-api | `user.address` | personal |
| shop-api | `user.id` | public |
| shop-api | `session.locale` | public |
| shop-api | `profile.address` | internal |
| search | `order.phone` | internal |
| accounts-api | `session.address` | personal |
| accounts-api | `session.phone` | personal |
| search | `session.id` | personal |
| accounts-api | `session.phone` | personal |
| accounts-api | `order.createdAt` | public |
| shop-api | `session.email` | public |
| shop-api | `user.name` | internal |
| billing | `session.id` | public |
| billing | `session.address` | public |
| accounts-api | `profile.phone` | public |
| billing | `profile.address` | internal |
| shop-api | `user.name` | public |
| accounts-api | `session.phone` | personal |
| shop-api | `order.phone` | personal |
| shop-api | `profile.createdAt` | public |
| accounts-api | `order.id` | internal |
| accounts-api | `session.id` | public |
| shop-api | `user.phone` | personal |
| shop-api | `session.createdAt` | public |
| billing | `session.createdAt` | public |
| search | `user.ip` | personal |
| search | `profile.phone` | public |
| accounts-api | `order.createdAt` | internal |
| accounts-api | `user.id` | personal |
| accounts-api | `order.name` | personal |
| billing | `profile.createdAt` | public |
| accounts-api | `order.phone` | personal |
| shop-api | `order.phone` | internal |
| billing | `session.ip` | personal |
| accounts-api | `order.name` | personal |
| search | `profile.name` | public |
| shop-api | `user.phone` | personal |
| shop-api | `session.email` | internal |
| search | `user.locale` | internal |
| billing | `user.ip` | public |
| accounts-api | `user.address` | public |
| accounts-api | `order.locale` | internal |
| billing | `session.phone` | public |
| shop-api | `session.ip` | personal |
| accounts-api | `order.phone` | public |
| billing | `user.address` | personal |
| accounts-api | `user.id` | personal |
| search | `user.name` | public |
| billing | `session.createdAt` | public |
| billing | `user.phone` | personal |
| billing | `order.name` | public |
| accounts-api | `order.name` | public |
| search | `order.email` | public |
| search | `session.ip` | personal |
| billing | `session.name` | internal |
| accounts-api | `session.email` | personal |
| billing | `user.email` | public |
| shop-api | `profile.ip` | personal |
| accounts-api | `user.phone` | internal |
| accounts-api | `user.name` | public |
| accounts-api | `user.email` | public |
| search | `profile.phone` | public |
| shop-api | `profile.locale` | internal |
| accounts-api | `session.phone` | public |
| search | `session.address` | internal |
| shop-api | `session.createdAt` | personal |
| search | `order.id` | public |
| accounts-api | `session.address` | internal |
| billing | `profile.email` | public |
| billing | `order.locale` | internal |
| search | `profile.createdAt` | personal |
