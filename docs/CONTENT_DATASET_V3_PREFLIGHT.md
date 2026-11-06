# Content dataset V3 — preflight, 2026-09-23

Status: NOT IMPLEMENTED. Database inspected read-only; no provider calls or dataset writes performed.

The existing agency is Pedro Gabriel, linked to the three requested clients. All three tenants are is_demo=true, dataset_version=content-v1. Do not create new organizations.

| Operation | Contacts actual → target | Won actual → target | Closed revenue actual → target | Spend actual → target |
|---|---:|---:|---:|---:|
| Vitta | 93 → 41 | 9 → 6 | 30,900 → 21,700 | 1,295 → 2,460 |
| Helios | 93 → 37 | 5 → 2 | 302,000 → 80,300 | 2,150 → 4,420 |
| Forma Casa | 110 → 34 | 5 → 2 | 126,000 → 38,300 | 1,220 → 2,180 |

Existing ad snapshots disagree with CRM in Helios (89 ad leads; 244,000 ad revenue) and Forma Casa (106 ad leads; 95,000 ad revenue). All tenants have zero appointments. There are three creatives per tenant. Vitta has five conversations/15 messages; the other tenants have none. Each tenant has four workflow definitions. Tasks: 0 / 1 / 0.

## Mathematical constraint to resolve

Vitta supplied individual sales: 3,200; 2,900; 4,100; 3,500; 3,100; 4,900, total 21,700. Creative B requires two sales totaling 7,500. No pair in this list totals 7,500, therefore creative A cannot simultaneously have four sales totaling 14,200 under exclusive attribution.

User-approved adjustment: change 3,500 to 3,400 and 3,100 to 3,200. Creative A: 3,200 + 2,900 + 3,200 + 4,900 = 14,200. Creative B: 4,100 + 3,400 = 7,500. The allocation is recorded in scripts/content-demo-v3-values.mjs with integer-cent assertions. Database migration is still pending; this file is not evidence of persisted sales.

## Existing implementation limitations

- seed-content-demo-run.mjs skips already seeded tenants; rerunning does not migrate them.
- seed-content-demo.mjs provisions organizations, so its provisioning path must not run for V3.
- Existing seed uses random dates/names and plausible phone numbers; V3 needs stable identifiers and non-deliverable contact details.
- Existing SVG thumbnails are 400×300, not requested portrait aspect ratios.
- Repository search found no RevenueAttentionService / STALE_OPPORTUNITY implementation in this checkout. This requires implementation or identifying the intended newer checkout.
- No isDemo check was found in runtime outbound services by the initial search. Absolute external-IO blocking is NOT proven. Do not execute seeds/automation runs until enforced and tested.
- Old rows are not individually marked with seed ownership. Migration must distinguish old controlled content from user edits before reducing counts.

## Delivered diagnostic

apps/api/scripts/validate-content-demo.mjs: read-only database snapshot comparing V3 totals, agency membership, attribution ownership, pipeline/stage ownership, appointments, and CRM/ad snapshot agreement. Exits nonzero on mismatch. It does not certify complete math, E2E, RLS, refresh stability, or provider safety.

Pending: migration, no-IO guards, refresh manifest, new assets, attention engine, UI/data paths, browser QA and full gates. No production-readiness claim.
