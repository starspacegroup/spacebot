// The incoming-webhook gate's decision rule, proved, compiled to JS for src/lib/server/webhook-gate.ts.
// Pure: the TS wrapper reads the hook row and the counter, and passes values in. Time is epoch seconds.

module WebhookGateCore {
  const MaxBodyBytes: int := 65536
  const RatePerWindow: int := 60
  const WindowSeconds: int := 60

  datatype Verdict = Accept | Unauthorized | TooLarge | RateLimited

  // ---- The functions the TS calls ----

  // The fixed minute that contains `now`.
  function WindowStart(now: int): int
    requires now >= 0
  { now - now % WindowSeconds }

  // The stored counter only counts while it belongs to the current minute.
  function EffectiveCount(storedStart: int, storedCount: int, now: int): int
    requires now >= 0
  { if storedStart == WindowStart(now) then storedCount else 0 }

  // The counter after one accepted call.
  function NextCount(storedStart: int, storedCount: int, now: int): int
    requires now >= 0
  { EffectiveCount(storedStart, storedCount, now) + 1 }

  // One outward answer for "no such hook", "disabled" and "wrong secret", decided before size
  // and rate, so a caller without the secret learns nothing from either.
  function Decide(found: bool, enabled: bool, secretMatches: bool, bodyBytes: int, effectiveCount: int): Verdict {
    if !(found && enabled && secretMatches) then Unauthorized
    else if bodyBytes > MaxBodyBytes then TooLarge
    else if effectiveCount >= RatePerWindow then RateLimited
    else Accept
  }

  // ---- Proofs ----

  lemma AcceptNeedsEverything(found: bool, enabled: bool, secretMatches: bool, bodyBytes: int, c: int)
    ensures Decide(found, enabled, secretMatches, bodyBytes, c) == Accept ==>
      found && enabled && secretMatches && bodyBytes <= MaxBodyBytes && c < RatePerWindow
  {}

  lemma AcceptWhenEverythingHolds(bodyBytes: int, c: int)
    requires bodyBytes <= MaxBodyBytes && c < RatePerWindow
    ensures Decide(true, true, true, bodyBytes, c) == Accept
  {}

  // The refusal for a missing hook, a disabled hook and a wrong secret is the same, whatever the
  // body size or the counter say.
  lemma UnauthorizedIgnoresSizeAndCount(found: bool, enabled: bool, secretMatches: bool, b1: int, c1: int, b2: int, c2: int)
    requires !(found && enabled && secretMatches)
    ensures Decide(found, enabled, secretMatches, b1, c1) == Unauthorized
    ensures Decide(found, enabled, secretMatches, b2, c2) == Unauthorized
  {}

  // An accepted call never takes the counter past the limit inside one minute.
  lemma AcceptKeepsCounterBounded(storedStart: int, storedCount: int, now: int, bodyBytes: int)
    requires now >= 0
    ensures Decide(true, true, true, bodyBytes, EffectiveCount(storedStart, storedCount, now)) == Accept ==>
      NextCount(storedStart, storedCount, now) <= RatePerWindow
  {}

  // A counter left over from an earlier minute counts for nothing.
  lemma StaleWindowIsEmpty(storedStart: int, storedCount: int, now: int)
    requires now >= 0 && storedStart != WindowStart(now)
    ensures EffectiveCount(storedStart, storedCount, now) == 0
    ensures NextCount(storedStart, storedCount, now) == 1
  {}

  lemma WindowStartIsMinuteBoundary(now: int)
    requires now >= 0
    ensures WindowStart(now) <= now < WindowStart(now) + WindowSeconds
    ensures WindowStart(now) % WindowSeconds == 0
  {}

  // After a rate-limited refusal the same minute still refuses, until the next minute starts.
  lemma RateLimitHoldsInsideMinute(storedStart: int, storedCount: int, now: int, later: int)
    requires 0 <= now <= later && WindowStart(later) == WindowStart(now)
    requires storedStart == WindowStart(now) && storedCount >= RatePerWindow
    ensures Decide(true, true, true, 0, EffectiveCount(storedStart, storedCount, later)) == RateLimited
  {}
}
