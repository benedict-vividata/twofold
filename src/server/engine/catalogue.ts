// What the alternative versions are made of.
//
// A degradation is a specific, reviewable flaw the alternative engine works
// into an otherwise correct change. The `instruction` is written for the agent;
// the `description` is what the interviewer sees when configuring a session.
//
// A trade-off is a genuine design tension with two defensible answers. Each
// side of a trade-off pair is implemented properly; the interesting part is
// whether the candidate can articulate what they are trading.
import type { DegradationCategory, DegradationInfo, TradeoffInfo } from "../../shared/model.js";

export interface Degradation extends DegradationInfo {
  instruction: string;
}

export interface Tradeoff extends TradeoffInfo {
  leftInstruction: string;
  rightInstruction: string;
}

function degradation(
  id: string,
  name: string,
  category: DegradationCategory,
  description: string,
  instruction: string,
): Degradation {
  return { id, name, category, description, instruction };
}

export const DEGRADATIONS: readonly Degradation[] = [
  degradation(
    "premature-abstraction",
    "Premature abstraction",
    "design",
    "An interface, factory, strategy or config layer for a problem with one concrete case.",
    "Introduce an abstraction the change does not need: an interface with a single implementation, a factory, registry or strategy for one case, a generic options object, or a class where a function would do. Route the feature through it so it is load-bearing. It should read as earnest 'planning ahead', with sensible names and tidy code.",
  ),
  degradation(
    "leaky-abstraction",
    "Leaky abstraction",
    "design",
    "Callers reach through a boundary into internals, or internals are handed out to callers.",
    "Make the change leak implementation details across an existing boundary: have a handler, view or caller reach directly into storage or another module's internal data structures instead of going through its API, return internal representations to callers, or expose mutable internal state. The feature must still work.",
  ),
  degradation(
    "wrong-layer",
    "Logic in the wrong layer",
    "design",
    "Business rules in a handler or view, formatting in the data layer, validation scattered into callers.",
    "Put the new logic in the wrong layer of this codebase: business rules inside a route handler, controller or UI component; presentation formatting inside the data or model layer; or validation pushed out into callers. Use the project's actual architecture to decide what the wrong layer is here.",
  ),
  degradation(
    "hidden-state",
    "Hidden shared state",
    "design",
    "Module-level mutable state, singletons or caches that quietly couple callers together.",
    "Introduce hidden shared mutable state where the clean version keeps data flow explicit: module-level or global variables, a singleton or ad-hoc cache that couples callers, or functions that mutate their arguments.",
  ),
  degradation(
    "duplicated-logic",
    "Duplicated logic",
    "maintainability",
    "Re-implements something the codebase already has, or copies the same block into several places.",
    "Duplicate logic instead of reusing it: re-implement inline something the codebase already provides (a helper, validator, query or constant), or copy the same block into two or more places with small variations instead of sharing it.",
  ),
  degradation(
    "ignores-conventions",
    "Ignores conventions",
    "maintainability",
    "Works, but in a different style from everything around it: errors, naming, utilities, structure.",
    "Ignore this project's established conventions for this kind of code — its error-handling style, existing utilities, naming, module layout or test style — and do it another way that still works, as someone who had not read the surrounding code would.",
  ),
  degradation(
    "god-function",
    "God function",
    "maintainability",
    "One long function that parses, validates, computes and formats, with nested branches and flags.",
    "Restructure the change so a single function does several jobs — parsing, validation, the core logic and formatting all inline — with nested conditionals, a long parameter list or boolean flag parameters, instead of small cohesive units.",
  ),
  degradation(
    "stringly-typed",
    "Magic values and loose types",
    "maintainability",
    "Magic strings and numbers, boolean flag parameters and untyped bags of values.",
    "Use magic strings and numbers, boolean flag parameters and loosely typed values (plain dictionaries or objects, `any`, untyped maps) where this codebase would use named constants, enums or precise types.",
  ),
  degradation(
    "noise",
    "Debris and noise",
    "maintainability",
    "Commented-out code, leftover debug output, unused variables and comments that narrate the code.",
    "Leave the debris a careless change leaves behind: commented-out code, leftover debug logging or prints, unused variables or parameters, and redundant comments that narrate what the code does. Do not break the project's formatter or linter if its checks run one.",
  ),
  degradation(
    "swallowed-errors",
    "Swallowed errors",
    "correctness",
    "Broad catches, silent defaults and log-and-continue, so real failures would go unnoticed.",
    "Handle failure badly but quietly: catch broad exceptions and continue, return a default or empty result on error, or log and carry on, so that real problems would be hidden. Existing tests must still pass.",
  ),
  degradation(
    "missing-edge-case",
    "Missing edge case",
    "correctness",
    "One realistic edge case left unhandled: empty input, a boundary, a missing value.",
    "Leave one realistic edge case unhandled that the clean version handles or that the request implies — empty input, a boundary value, an off-by-one at a limit, a missing or null value. Existing tests must still pass; the gap should be findable by careful reading, not obvious.",
  ),
  degradation(
    "unsafe-input",
    "Trusts its input",
    "correctness",
    "Skipped validation, string-built queries or paths, or a missing authorisation check.",
    "Trust input that should be checked: skip validation or bounds checks on user-supplied values, build queries, paths or commands by string concatenation, or omit an authorisation or ownership check that the surrounding code performs elsewhere. Keep it subtle and plausible.",
  ),
  degradation(
    "inefficient",
    "Needless work",
    "performance",
    "Queries or I/O in a loop, quadratic scans, recomputation, loading everything to use a little.",
    "Make the change needlessly inefficient in a way that would matter at scale: queries or I/O inside a loop (N+1), quadratic scans where a lookup would do, recomputing values on every call, or loading everything in order to use a small part of it.",
  ),
  degradation(
    "weak-tests",
    "Weak tests",
    "testing",
    "Tests that pass but prove little: no real assertions, mocking the thing under test, happy path only.",
    "If the change includes tests, weaken them while keeping them passing: assert only that nothing throws or that a result exists, mock the very thing under test, or cover only the happy path. If the change has no tests, add one of that weak kind for the new behaviour.",
  ),
];

export const TRADEOFFS: readonly Tradeoff[] = [
  {
    id: "minimal-vs-extensible",
    name: "Minimal vs. extensible",
    left: "Minimal",
    right: "Extensible",
    leftInstruction:
      "Do the simplest thing that fully satisfies the request. No anticipated generality, no extension points, nothing the request does not need.",
    rightInstruction:
      "Satisfy the request, and leave one modest, well-placed extension point for the most likely next requirement — without speculative layers.",
  },
  {
    id: "explicit-vs-dry",
    name: "Explicit vs. DRY",
    left: "Explicit",
    right: "DRY",
    leftInstruction:
      "Prefer explicit, local code that reads top to bottom, even if a few lines repeat.",
    rightInstruction:
      "Factor any shared logic into small reusable helpers so that nothing is said twice.",
  },
  {
    id: "defensive-vs-lean",
    name: "Defensive vs. lean",
    left: "Defensive",
    right: "Lean",
    leftInstruction:
      "Validate inputs and handle errors explicitly at every boundary the change touches.",
    rightInstruction:
      "Validate once at the outer edge, trust internal callers, and keep the core logic lean.",
  },
  {
    id: "clarity-vs-performance",
    name: "Clarity vs. performance",
    left: "Clarity",
    right: "Performance",
    leftInstruction: "Optimise for readability and obviousness; accept modest runtime overhead.",
    rightInstruction:
      "Optimise for runtime efficiency where it plausibly matters, accepting some extra complexity.",
  },
];

export function degradationInfo(): DegradationInfo[] {
  return DEGRADATIONS.map(({ id, name, category, description }) => ({
    id,
    name,
    category,
    description,
  }));
}

export function tradeoffInfo(): TradeoffInfo[] {
  return TRADEOFFS.map(({ id, name, left, right }) => ({ id, name, left, right }));
}

export function findDegradation(id: string): Degradation | undefined {
  return DEGRADATIONS.find((entry) => entry.id === id);
}

export const DEFAULT_DEGRADATIONS: readonly string[] = DEGRADATIONS.map((entry) => entry.id);
