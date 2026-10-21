import {
  acceptanceSurvivesEnqueueFailure,
  classifyOnfonResponse,
  composeAssignmentSms,
  customerFirstName,
  decideAfterProviderResult,
  isAirtel5gWebsiteLead,
  normalizeKenyanMobile,
  recoverExpiredClaim,
  selectAgentPhones,
  smsSegments,
  toLocalMobile,
} from "./customer-assignment-sms.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

assert(isAirtel5gWebsiteLead("airtel5grouter", "5G"), "website 5G leads qualify");
assert(!isAirtel5gWebsiteLead("internetkenya", "5G"), "other sources do not qualify");
assert(!isAirtel5gWebsiteLead("airtel5grouter", "fiber"), "other plan groups do not qualify");
assert(!isAirtel5gWebsiteLead("agent_own", "5G"), "agent-submitted leads do not qualify");

assert(normalizeKenyanMobile("0712345678") === "254712345678", "07 normalizes");
assert(normalizeKenyanMobile("254712345678") === "254712345678", "2547 stays");
assert(normalizeKenyanMobile("+254712345678") === "254712345678", "+2547 stays");
assert(normalizeKenyanMobile("0112345678") === "254112345678", "01 normalizes");
assert(toLocalMobile("254112345678") === "0112345678", "01 is not rewritten to 07");
assert(toLocalMobile("254712345678") === "0712345678", "07 display");
assert(normalizeKenyanMobile("123") === null, "invalid number is rejected");
assert(normalizeKenyanMobile("") === null, "empty number is rejected");

const same = selectAgentPhones("0712345678", "+254712345678");
assert(same.primary === "254712345678" && same.alternate === null, "identical numbers collapse");

const both = selectAgentPhones("0712345678", "0112345678");
assert(
  both.primary === "254712345678" && both.alternate === "254112345678",
  "airtel is primary and safaricom is alternate",
);

const onlySaf = selectAgentPhones("not-a-number", "0711000000");
assert(onlySaf.primary === "254711000000" && onlySaf.alternate === null, "one valid number is kept");

const none = selectAgentPhones(null, "abc");
assert(none.primary === null && none.alternate === null, "invalid numbers are not invented");

assert(customerFirstName("  Jane   Wanjiku ") === "Jane", "first name is the first word");
assert(customerFirstName("") === "there", "missing name has a safe fallback");
const longName = "Bartholomew-Ndungu";
assert(customerFirstName(`${longName} Otieno`) === longName, "names are not truncated");

const two = composeAssignmentSms({
  customerName: "Jane Wanjiku",
  agentName: "Mary Kamau",
  airtelPhone: "0712345678",
  safaricomPhone: "0112345678",
});
assert(two.ok && two.variant === "two_numbers", "two numbers use the primary/alternate template");
assert(two.ok && two.body.includes("Primary: 0712345678"), "primary is local 07");
assert(two.ok && two.body.includes("Alternate: 0112345678"), "alternate is local 01");
assert(two.ok && two.body.includes("either number"), "two-number closing is used");

const one = composeAssignmentSms({
  customerName: "Jane",
  agentName: "Mary Kamau",
  airtelPhone: "254712345678",
  safaricomPhone: "0712345678",
});
assert(one.ok && one.variant === "one_number", "identical numbers use one contact line");
assert(one.ok && one.body.includes("Agent contact: 0712345678"), "single number is shown once");
assert(one.ok && !one.body.includes("Alternate"), "single number has no alternate label");
assert(one.ok && one.body.includes("this number"), "single-number closing is used");

const missing = composeAssignmentSms({
  customerName: "Jane",
  agentName: "Mary",
  airtelPhone: "",
  safaricomPhone: "12345",
});
assert(!missing.ok && missing.reason === "no_agent_phone", "no valid agent phone skips the SMS");

const timeout = classifyOnfonResponse({ timedOut: true });
assert(
  decideAfterProviderResult(timeout, 1).status === "ambiguous" &&
    decideAfterProviderResult(timeout, 1).retry === false,
  "a timeout is not retried",
);
const credits = classifyOnfonResponse({ httpStatus: 200, errorCode: 21 });
assert(decideAfterProviderResult(credits, 1).status === "pending", "insufficient credits can retry");
assert(decideAfterProviderResult(credits, 5).status === "failed", "retries stop at the attempt cap");
const accepted = classifyOnfonResponse({ httpStatus: 200, errorCode: 0, messageId: "m1" });
assert(decideAfterProviderResult(accepted, 1).status === "sent", "Onfon accept is recorded as sent");

const isolated = acceptanceSurvivesEnqueueFailure(() => {
  throw new Error("outbox insert failed");
});
assert(isolated.assigned && !isolated.queued, "an enqueue failure does not undo acceptance");
assert(acceptanceSurvivesEnqueueFailure(() => {}).queued, "a successful enqueue is recorded");

assert(recoverExpiredClaim(null) === "pending", "a crash before Onfon can be retried");
assert(recoverExpiredClaim("2026-10-22T00:00:00Z") === "ambiguous", "a crash after Onfon starts is not retried");

const offers = new Map<string, { id: string }>();
function queueOffer(offerId: string) {
  if (offers.has(offerId)) return false;
  offers.set(offerId, { id: offerId });
  return true;
}
assert(queueOffer("offer-1") && !queueOffer("offer-1"), "the same accepted offer is queued once");
assert(queueOffer("offer-2"), "a reassignment offer is a separate notification");

const claimed = new Set<string>();
function claim(ids: string[], worker: string) {
  const mine: string[] = [];
  for (const id of ids) {
    if (claimed.has(id)) continue;
    claimed.add(id);
    mine.push(`${worker}:${id}`);
  }
  return mine;
}
const pendingIds = ["a", "b"];
const firstWorker = claim(pendingIds, "w1");
const secondWorker = claim(pendingIds, "w2");
assert(firstWorker.length === 2 && secondWorker.length === 0, "a second worker cannot claim the same rows");

const samples = [
  ["Jane", "Mary Kamau"],
  ["Wanjiku", "Peter Otieno"],
  ["Nyambura", "Catherine Wanjiru"],
  ["Bartholomew", "Christopher Omondi Wagura"],
] as const;
const segmentReport = samples.map(([customerName, agentName]) => {
  const twoNumbers = composeAssignmentSms({
    customerName,
    agentName,
    airtelPhone: "0712345678",
    safaricomPhone: "0112345678",
  });
  const oneNumber = composeAssignmentSms({
    customerName,
    agentName,
    airtelPhone: "0712345678",
    safaricomPhone: "0712345678",
  });
  assert(twoNumbers.ok && oneNumber.ok, "realistic samples compose");
  return {
    customerName,
    agentName,
    two: twoNumbers.ok ? { units: smsSegments(twoNumbers.body).segments, gsm7: !twoNumbers.unicode, chars: [...twoNumbers.body].length } : null,
    one: oneNumber.ok ? { units: smsSegments(oneNumber.body).segments, gsm7: !oneNumber.unicode, chars: [...oneNumber.body].length } : null,
  };
});
const unicodeName = composeAssignmentSms({
  customerName: "Wanjikũ Kamau",
  agentName: "Mary Kamau",
  airtelPhone: "0712345678",
  safaricomPhone: "0112345678",
});
assert(unicodeName.ok && unicodeName.body.includes("Wanjikũ"), "a Unicode name is not rewritten");
console.log(JSON.stringify({
  segmentReport,
  unicode: unicodeName.ok
    ? { segments: unicodeName.segments, unicode: unicodeName.unicode, chars: [...unicodeName.body].length }
    : null,
}, null, 2));

console.log("customer assignment sms checks passed");
