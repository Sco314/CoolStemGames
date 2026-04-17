/**
 * Collatz Cascade — Game Loop Controller
 *
 * Manages the prediction → launch → run → results → replay cycle.
 * Sits on top of numberline.js (which handles the 3D animation).
 *
 * Game states:
 *   idle     → waiting for the player to enter a number
 *   predict  → number entered, player choosing a step-count bucket
 *   launch   → brief anticipation before the ball fires
 *   running  → ball is traversing the Collatz sequence
 *   results  → run complete, showing score + stats
 */

import { stoppingTime } from './collatz.js';
import { formatValue } from './valueUtils.js';

// ── Step-count prediction buckets ────────────────────────
const BUCKETS = [
  { label: '1–10',   min: 1,   max: 10  },
  { label: '11–20',  min: 11,  max: 20  },
  { label: '21–40',  min: 21,  max: 40  },
  { label: '41–80',  min: 41,  max: 80  },
  { label: '81–160', min: 81,  max: 160 },
  { label: '160+',   min: 161, max: Infinity },
];

// ── Scoring ──────────────────────────────────────────────
const SCORE_EXACT = 100;       // correct bucket
const SCORE_ADJACENT = 50;     // one bucket away
const SCORE_TWO_AWAY = 25;     // two buckets away
const SCORE_PARTICIPATION = 10;
const STREAK_BONUS = 10;       // per consecutive correct

// ── State ────────────────────────────────────────────────
let gameState = 'idle';        // idle | predict | launch | running | results
let currentNumber = null;
let currentSteps = null;       // actual step count (computed on launch)
let selectedBucket = -1;       // index into BUCKETS
let correctBucket = -1;        // index of the correct bucket

let totalScore = 0;
let streak = 0;
let roundsPlayed = 0;
let lastRoundScore = 0;
let lastRoundCorrect = false;

// Result tags for flavor text
const RESULT_TAGS = [
  { maxSteps: 5,   tag: 'Quick drop' },
  { maxSteps: 15,  tag: 'Short and direct' },
  { maxSteps: 30,  tag: 'Moderate journey' },
  { maxSteps: 60,  tag: 'Slow burner' },
  { maxSteps: 100, tag: 'Big climber' },
  { maxSteps: 200, tag: 'Wild ride' },
  { maxSteps: Infinity, tag: 'Epic odyssey' },
];

// ── Public API ───────────────────────────────────────────

export function getGameState() { return gameState; }
export function getTotalScore() { return totalScore; }
export function getStreak() { return streak; }
export function getRoundsPlayed() { return roundsPlayed; }
export function getBuckets() { return BUCKETS; }
export function getSelectedBucket() { return selectedBucket; }
export function getCurrentNumber() { return currentNumber; }

/**
 * Player has entered a number → transition to prediction phase.
 */
export function submitNumber(n) {
  if (gameState !== 'idle') return false;
  currentNumber = n;
  selectedBucket = -1;
  gameState = 'predict';
  return true;
}

/**
 * Player selects a prediction bucket.
 */
export function selectBucket(index) {
  if (gameState !== 'predict') return;
  if (index < 0 || index >= BUCKETS.length) return;
  selectedBucket = index;
}

/**
 * Player confirms prediction → compute answer, transition to launch.
 * Returns the number to pass to startSequence().
 */
export function confirmLaunch() {
  if (gameState !== 'predict' || selectedBucket < 0) return null;

  // Compute the actual step count
  currentSteps = stoppingTime(currentNumber);

  // Find the correct bucket
  correctBucket = BUCKETS.findIndex(b => currentSteps >= b.min && currentSteps <= b.max);
  if (correctBucket < 0) correctBucket = BUCKETS.length - 1;

  gameState = 'launch';

  // Brief launch anticipation — the caller should start the
  // sequence after a short delay or immediately.
  return currentNumber;
}

/**
 * Called when the launch animation starts (ball begins moving).
 */
export function onRunStart() {
  gameState = 'running';
}

/**
 * Called when the sequence run completes.
 * Calculates score and returns the results object.
 */
export function onRunComplete() {
  if (gameState !== 'running') return null;

  // Score based on bucket distance
  const dist = Math.abs(selectedBucket - correctBucket);
  let roundScore;
  if (dist === 0) {
    roundScore = SCORE_EXACT;
    streak++;
    lastRoundCorrect = true;
  } else if (dist === 1) {
    roundScore = SCORE_ADJACENT;
    streak = 0;
    lastRoundCorrect = false;
  } else if (dist === 2) {
    roundScore = SCORE_TWO_AWAY;
    streak = 0;
    lastRoundCorrect = false;
  } else {
    roundScore = SCORE_PARTICIPATION;
    streak = 0;
    lastRoundCorrect = false;
  }

  // Streak bonus
  if (lastRoundCorrect && streak > 1) {
    roundScore += (streak - 1) * STREAK_BONUS;
  }

  lastRoundScore = roundScore;
  totalScore += roundScore;
  roundsPlayed++;

  // Result tag
  const tag = RESULT_TAGS.find(t => currentSteps <= t.maxSteps)?.tag || 'Unknown';

  gameState = 'results';

  return {
    number: currentNumber,
    numberDisplay: formatValue(currentNumber),
    actualSteps: currentSteps,
    guessedBucket: BUCKETS[selectedBucket],
    correctBucket: BUCKETS[correctBucket],
    isCorrect: selectedBucket === correctBucket,
    bucketDistance: dist,
    roundScore: lastRoundScore,
    totalScore,
    streak,
    roundsPlayed,
    tag,
  };
}

/**
 * Player clicks "Next" → reset for next round.
 */
export function nextRound() {
  currentNumber = null;
  currentSteps = null;
  selectedBucket = -1;
  correctBucket = -1;
  gameState = 'idle';
}

/**
 * Reset everything (new session).
 */
export function resetGame() {
  nextRound();
  totalScore = 0;
  streak = 0;
  roundsPlayed = 0;
  lastRoundScore = 0;
  lastRoundCorrect = false;
}
