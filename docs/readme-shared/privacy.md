## Privacy

- With `recency` or `local`, nothing is sent anywhere.
- With `jev`, the goal and a short excerpt of each entry are sent to TypeSafe AI's Jev API, after
  common secret formats are replaced with `[REDACTED]` and without entry ids. The masking is
  pattern matching: it narrows exposure but can't recognize every secret.
- Without a usable `TYPESAFE_API_KEY` (unset, blank, or an unexpanded placeholder such as
  `${TYPESAFE_API_KEY}`), nothing is sent, and whatever asked for Jev says so.

How well the masking works is measured in the [evaluation](../../docs/evaluation.md#secret-masking-measured-blind).
To report a leak, see the [security policy](../../SECURITY.md).
