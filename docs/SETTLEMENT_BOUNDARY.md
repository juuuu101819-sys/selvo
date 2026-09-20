# The settlement boundary: how a customer acts on a Meridian instruction

Meridian decides **which** route is best. It never moves the money. This document is the concrete
handoff: what Meridian returns, how a customer or their licensed provider verifies it, and where
Meridian's involvement stops.

If you only read one paragraph: Meridian signs a recommendation and hands it to you. The signature
proves the recommendation is Meridian's and unaltered. It is **not** a payment authorization, and
Meridian has no code path that sends the instruction anywhere on your behalf.

---

## Why the artifact exists

Before this existed, `POST /api/v1/execution-intents` recorded that a customer had chosen a route
and returned an id. There was nothing a customer could do with it. The non-custodial boundary held,
but only because the feature was inert — which is the absence of a capability, not an architecture.

`POST /api/v1/settlement/instructions` replaces that with an artifact you can verify independently
and take to a provider you already have a relationship with. The boundary now holds because of what
the system returns, not because of what it cannot do.

---

## The two boundary modes

Every instruction carries `boundaryMode`, and there are exactly two values:

| Mode | Who executes | Meridian's role |
| --- | --- | --- |
| `RETURN_TO_CUSTOMER` | You, through your own provider relationship | Compose, sign, return |
| `PARTNER_EXECUTES` | A licensed partner **you** contracted separately | Compose, sign, return |

There is deliberately no third value. A mode meaning "Meridian dispatches" is not representable in
the type, not accepted by the `settlement_instructions_boundary_mode_known` CHECK constraint, and
not producible by any configuration or feature flag. `POST /api/v1/executions` returns `501` and
continues to do so.

---

## What the Meridian signature means

Stated in full inside the signed bytes, so it cannot be separated from the artifact by whoever
forwards it:

`signatureAttests`:

> Meridian produced this routing recommendation and it has not been altered.

`signatureDoesNotAttest`:

> Meridian does not authorize, initiate, or transmit any movement of funds. This signature is not a payment authorization. The customer authorizes and executes through their own licensed provider relationship.

A provider that treats this signature as a payment authorization has misread it. Meridian is not a
party to the payment, holds no customer funds, and holds no keys that could move them.

Your own signature is the one that carries authority, and it carries it at your provider — not here.
Meridian stores a counter-signature you return purely so you have an auditable record that you
approved this exact artifact. Storing it triggers nothing.

---

## Verifying an instruction

Every response ships the procedure in `nextSteps`, and `GET /api/v1/settlement/verification`
publishes it independently. The steps:

1. **Canonicalize `payload`.** Sorted keys, no insignificant whitespace, `null` for null,
   `true`/`false` for booleans, integers unquoted, every money value already a string. All money is
   an integer count of minor units, never a float — a binary float in a signed artifact would be a
   rounding bug with a signature making it look authoritative.
2. **Compare with `payloadCanonical`** byte for byte. This field is the exact string that was
   signed; comparing against it is how you confirm your canonicalizer agrees with Meridian's before
   you trust a verification result.
3. **SHA-256 the canonical UTF-8 bytes** and confirm the hex digest equals `payloadHash`.
4. **Fetch the public key** for `verification.keyId` from `verification.jwksUri`
   (`GET /api/v1/settlement/keys`). No credential is required: an artifact your provider cannot
   verify without a Meridian account would be unusable by the party it is meant for.
5. **Verify the Ed25519 signature** (base64url, in `signature`) over the canonical bytes.
6. **Check the clock.** `payload.expiresAt` and `payload.quoteExpiresAt` must both be in the future.
7. **Read `signatureDoesNotAttest`** before acting. See above.

`POST /api/v1/settlement/instructions/verify` will do steps 1–5 for you. Treat it as a convenience
for development: verifying a signature by asking the signer whether it is valid is not verification.

### Worked example

```bash
BASE=https://api.meridian.example/api/v1

curl -s "$BASE/settlement/instructions/$ID" -H "x-api-key: $KEY" \
  | jq '.data' > instruction.json
curl -s "$BASE/settlement/keys" | jq '.data' > jwks.json
```

```python
import base64, hashlib, json
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

instruction = json.load(open("instruction.json"))
jwks = json.load(open("jwks.json"))["keys"]

def b64u(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

def canonical(value) -> str:
    if isinstance(value, dict):
        return "{" + ",".join(f"{json.dumps(k)}:{canonical(value[k])}" for k in sorted(value)) + "}"
    if isinstance(value, list):
        return "[" + ",".join(canonical(v) for v in value) + "]"
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, int):
        return str(value)
    return json.dumps(value)

canonical_bytes = canonical(instruction["payload"]).encode()
assert canonical_bytes.decode() == instruction["payloadCanonical"], "canonicalization disagrees"
assert hashlib.sha256(canonical_bytes).hexdigest() == instruction["payloadHash"], "hash mismatch"

key = next(k for k in jwks if k["kid"] == instruction["verification"]["keyId"])
assert "d" not in key, "JWKS should never carry private material"
Ed25519PublicKey.from_public_bytes(b64u(key["x"])).verify(
    b64u(instruction["signature"]), canonical_bytes
)
print("verified:", instruction["payload"]["signatureDoesNotAttest"])
```

This example is not decorative. The Phase 9 verification run drove exactly this code against a
live API on the PostgreSQL driver, with an independent canonicalizer outside the TypeScript
codebase, and it verified.

---

## Key rotation

`verification.keyId` names the key that signed a given instruction. `GET /api/v1/settlement/keys`
publishes every key still valid for verification, newest last.

Rotation mints a new generation and makes it active for new signatures. Retired public keys stay
published until every instruction they signed has expired, because an artifact already in a
customer's hands must not stop verifying for Meridian's operational convenience. Cache the JWKS if
you like, but re-fetch on an unknown `kid` rather than treating it as a failed signature — the two
mean different things, and `POST .../verify` distinguishes them (`unknown_key` versus
`signature_invalid`).

Private keys live in the encrypted credential vault. The JWK type Meridian publishes has no `d`
parameter, so private material is not omitted from the response — it is not expressible in it.

---

## Expiry and freshness

An instruction has two deadlines and dies at the earlier one:

- `expiresAt` — the artifact's own lifetime, capped by `SETTLEMENT_INSTRUCTION_TTL_SECONDS`
  (default 900).
- `quoteExpiresAt` — when the quote the numbers came from goes stale.

`expiresAt` is never later than `quoteExpiresAt`. An instruction that outlived its quote would carry
a price no provider will honour, with a signature making it look current.

Reads report this rather than hiding it: `usable` and `unusableReason` (`expired` or `quote_stale`)
are evaluated at read time, so an instruction that was fine when generated and is not fine now says
so. Re-quote and generate a new one; do not attempt to extend an existing artifact.

---

## What is inside a signed instruction

`instructionVersion` is `"1"`. The field set for a version is **closed**: Meridian cannot add a
field without bumping the version, because a widened payload would silently change what existing
signatures cover and a verifier pinned to version 1 would start failing for reasons unrelated to
tampering.

| Field | Contents |
| --- | --- |
| `instructionVersion`, `purpose` | Artifact version and kind |
| `instructionId`, `organizationId` | This artifact, and whose it is |
| `createdAt`, `expiresAt`, `quoteExpiresAt` | The two deadlines, plus when it was made |
| `originEnv` | `DEMO`, `SIMULATION`, `PARTNER_SANDBOX`, or `PRODUCTION` |
| `boundaryMode` | Who acts on it |
| `route` | `routingId`, `routeId`, provider identity and licensing, rail, legs, assets, send and delivered minor units, rates, rank, competing route count, best-execution rationale hash |
| `costs` | Total, provider, platform and network fees in minor units, plus cost/spread/slippage in bps |
| `authorization` | `paymentIntentId`, `executionIntentId`, `policyEvaluated` |
| `compliance` | Eligibility, KYC and sanctions-screening requirements, licensing, jurisdictions |
| `signatureAttests`, `signatureDoesNotAttest` | What the signature does and does not mean |
| `meridianTransmits`, `meridianIsPayer`, `fundsMoved`, `custody`, `transferSigned`, `meridianKeysUsed` | Non-custodial invariants, all `false` |

**Route and cost values are the deterministic engine's, not the caller's.** A request names a stored
routing evaluation and a route inside it; the amounts are recomputed from that stored snapshot. You
choose *which* route. You cannot state what it costs, and no AI-authored number can enter a signed
instruction.

**No beneficiary data.** Account numbers, IBANs, wallet addresses and beneficiary names are refused
before signing (`FORBIDDEN_SETTLEMENT_INSTRUCTION_KEYS`). Those details travel between you and your
provider. Meridian does not need them and will not sign them.

`originEnv` is worth reading. A sandbox instruction says `SIMULATION`, and no non-production origin
can ever contribute to realized revenue — see `docs/PHASE_8_REPORT.md`.

---

## Where Meridian stops

Returning the artifact is the whole of it. Concretely:

- No handler on `/settlement/*` calls a provider, enqueues work, or reaches the partner-dispatch
  service. `SettlementInstructionService` is constructed without the partner registry, so there is
  no object graph along which it could.
- The `settlement_instructions` table has no status to advance, no `dispatched_at`, no
  `submitted_at`, and no partner reference. `meridian_transmitted` is pinned `false` by the
  `settlement_instructions_never_transmitted` constraint, so recording a transmission would require
  dropping a named constraint first — a reviewable act, not a silent one.
- Generating, signing, returning, and counter-signing an instruction does not advance revenue past
  `ATTRIBUTED_REVENUE`. Returning an artifact is not a settlement and not a collection.
  `REALIZED_REVENUE` still requires all four facts: production origin, provider-confirmed
  settlement finality, `collected` recognition, and a processor reference.
- Settlement status is advanced only by provider-confirmed events. Meridian generating an instruction
  advances nothing.

`apps/api/src/routes/settlement-boundary.test.ts` asserts each of these, including that a fully
counter-signed instruction still produces zero outbound calls and zero partner rows.

---

## Pattern B: a partner you contracted

`PARTNER_EXECUTES` covers the case where a licensed partner executes rather than you directly. The
difference is only who you hand the artifact to. Meridian still generates and returns; the partner
relationship, the contract, and the authorization are yours.

`eligibleVenues` names where the instruction can go. Every entry is flagged
`customerMustHaveOwnRelationship: true` — it is a directory entry, not a referral, and not an
introduction Meridian brokers.

The sandbox partner-dispatch machinery under `/api/v1/partner-instructions` is a separate,
sandbox-only simulation used for orchestration testing. It is gated by `PLATFORM_MODE`,
`EXECUTION_ENABLED`, and `PARTNER_LIVE_ENABLED`, contains no live adapter, and is not reachable from
the settlement-instruction path. It is not how Pattern B works in production.

---

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/settlement/instructions` | `transaction:create` | Generate and return a signed instruction |
| `GET` | `/api/v1/settlement/instructions/:id` | `transaction:create` | Read one, with freshness |
| `POST` | `/api/v1/settlement/instructions/:id/customer-signature` | `transaction:create` | Store your counter-signature (no dispatch) |
| `POST` | `/api/v1/settlement/instructions/verify` | public | Verify a signature (convenience) |
| `GET` | `/api/v1/settlement/keys` | public | JWKS of signing keys |
| `GET` | `/api/v1/settlement/verification` | public | Procedure and signature semantics |
| `GET` | `/api/v1/execution-intents/:id` | `transaction:create` | The intent an instruction was generated from |
| `POST` | `/api/v1/executions` | — | **`501`.** Meridian does not execute transactions. |
