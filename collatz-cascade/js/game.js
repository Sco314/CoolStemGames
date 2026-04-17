/**
 * Collatz Cascade — Game Loop Controller
 *
 * Four game modes:
 *   guessSteps  — guess the step-count bucket for a given number
 *   hitRange    — find a number whose steps fall in a target band
 *   findLongest — pick the number with the longest run in a range
 *   freeExplore — no scoring, pure exploration
 *
 * Game states:
 *   idle     → mode select / waiting for input
 *   predict  → player making their prediction/choice
 *   launch   → plunger compression animation
 *   running  → ball traversing the sequence
 *   results  → showing score + stats
 */

import { stoppingTime, peakValue, collatzValues } from './collatz.js';
import { formatValue } from './valueUtils.js';

// ── Game modes ──────────────────────────────────────────
export const MODES = [
  { id: 'guessSteps',  label: 'Guess the Steps',   icon: '\uD83C\uDFAF', desc: 'Predict how many steps a number takes' },
  { id: 'hitRange',    label: 'Hit the Range',      icon: '\uD83C\uDFF9', desc: 'Find a number in a target step band' },
  { id: 'findLongest', label: 'Find the Longest',   icon: '\uD83C\uDFC6', desc: 'Pick the longest run in a range' },
  { id: 'freeExplore', label: 'Free Explore',       icon: '\uD83D\uDD2D', desc: 'Explore any number, no pressure' },
];

// ── Step-count prediction buckets (for guessSteps) ──────
const BUCKETS = [
  { label: '1–10',   min: 1,   max: 10  },
  { label: '11–20',  min: 11,  max: 20  },
  { label: '21–40',  min: 21,  max: 40  },
  { label: '41–80',  min: 41,  max: 80  },
  { label: '81–160', min: 81,  max: 160 },
  { label: '160+',   min: 161, max: Infinity },
];

// ── Hit-the-Range challenge templates ───────────────────
const RANGE_CHALLENGES = [
  { numRange: [1, 100],   stepBand: [1, 10],   label: '1–10 steps' },
  { numRange: [1, 100],   stepBand: [11, 20],  label: '11–20 steps' },
  { numRange: [1, 200],   stepBand: [21, 40],  label: '21–40 steps' },
  { numRange: [1, 500],   stepBand: [41, 80],  label: '41–80 steps' },
  { numRange: [1, 1000],  stepBand: [81, 120], label: '81–120 steps' },
  { numRange: [1, 500],   stepBand: [1, 15],   label: '1–15 steps' },
  { numRange: [100, 500], stepBand: [20, 50],  label: '20–50 steps' },
];

// ── Find-Longest challenge templates ────────────────────
const LONGEST_CHALLENGES = [
  { lo: 1,   hi: 50  },
  { lo: 1,   hi: 100 },
  { lo: 50,  hi: 150 },
  { lo: 100, hi: 200 },
  { lo: 200, hi: 300 },
  { lo: 1,   hi: 500 },
  { lo: 500, hi: 1000 },
];

// ── Scoring ──────────────────────────────────────────────
const SCORE_EXACT = 100;
const SCORE_ADJACENT = 50;
const SCORE_TWO_AWAY = 25;
const SCORE_PARTICIPATION = 10;
const STREAK_BONUS = 10;
const SCORE_HIT_RANGE = 100;
const SCORE_MISS_RANGE = 10;
const SCORE_LONGEST_EXACT = 150;
const SCORE_LONGEST_TOP3 = 100;
const SCORE_LONGEST_TOP10 = 50;

// ── Result tags ─────────────────────────────────────────
const RESULT_TAGS = [
  { maxSteps: 5,   tag: 'Quick Drop',      icon: '\u26A1',       color: '#4fb06f' },
  { maxSteps: 15,  tag: 'Short & Sweet',   icon: '\u2728',       color: '#6ad4e0' },
  { maxSteps: 30,  tag: 'Steady Traveler', icon: '\uD83D\uDEB6', color: '#4a9aff' },
  { maxSteps: 60,  tag: 'Slow Burner',     icon: '\uD83D\uDD25', color: '#ff9a4a' },
  { maxSteps: 100, tag: 'Big Climber',     icon: '\u26F0\uFE0F', color: '#ff6b4a' },
  { maxSteps: 200, tag: 'Wild Ride',       icon: '\uD83C\uDF0B', color: '#aa66cc' },
  { maxSteps: Infinity, tag: 'Epic Odyssey', icon: '\uD83C\uDF0C', color: '#ffd866' },
];

// ── State ────────────────────────────────────────────────
let gameMode = 'guessSteps';
let gameState = 'idle';
let currentNumber = null;
let currentSteps = null;
let selectedBucket = -1;
let correctBucket = -1;

// Challenge state (for hitRange and findLongest)
let challenge = null;

let totalScore = 0;
let streak = 0;
let roundsPlayed = 0;
let lastRoundScore = 0;
let lastRoundCorrect = false;

// ── Leaderboard (localStorage) ──────────────────────────
const STORAGE_KEY = 'collatz-cascade-scores';

function loadScores() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data) {
      totalScore = data.totalScore || 0;
      streak = data.streak || 0;
      roundsPlayed = data.roundsPlayed || 0;
    }
  } catch { /* ignore */ }
}

function saveScores() {
  try {
    const data = {
      totalScore, streak, roundsPlayed,
      highScore: Math.max(totalScore, getHighScore()),
      bestStreak: Math.max(streak, getBestStreak()),
      timestamp: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

export function getHighScore() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return data?.highScore || 0;
  } catch { return 0; }
}

export function getBestStreak() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return data?.bestStreak || 0;
  } catch { return 0; }
}

// ── Public API ───────────────────────────────────────────
export function getGameMode() { return gameMode; }
export function getGameState() { return gameState; }
export function getTotalScore() { return totalScore; }
export function getStreak() { return streak; }
export function getRoundsPlayed() { return roundsPlayed; }
export function getBuckets() { return BUCKETS; }
export function getSelectedBucket() { return selectedBucket; }
export function getCurrentNumber() { return currentNumber; }
export function getChallenge() { return challenge; }

export function setGameMode(mode) {
  if (!MODES.find(m => m.id === mode)) return;
  gameMode = mode;
  nextRound();
}

// ── Generate a challenge (for hitRange and findLongest) ──
export function generateChallenge() {
  if (gameMode === 'hitRange') {
    const template = RANGE_CHALLENGES[Math.floor(Math.random() * RANGE_CHALLENGES.length)];
    challenge = {
      numRange: template.numRange,
      stepBand: template.stepBand,
      label: template.label,
      instruction: `Find a number from ${template.numRange[0]}–${template.numRange[1]} that takes ${template.label}`,
    };
  } else if (gameMode === 'findLongest') {
    const template = LONGEST_CHALLENGES[Math.floor(Math.random() * LONGEST_CHALLENGES.length)];
    // Pre-compute the actual longest in the range
    let bestN = template.lo, bestSteps = 0;
    for (let i = template.lo; i <= template.hi; i++) {
      const s = stoppingTime(i);
      if (s > bestSteps) { bestSteps = s; bestN = i; }
    }
    challenge = {
      lo: template.lo,
      hi: template.hi,
      bestN,
      bestSteps,
      instruction: `Pick a number from ${template.lo}–${template.hi} with the longest run`,
    };
  } else {
    challenge = null;
  }
  return challenge;
}

// ── Submit number ───────────────────────────────────────
export function submitNumber(n) {
  if (gameState !== 'idle') return false;

  // Validate for mode-specific constraints
  if (gameMode === 'hitRange' && challenge) {
    const num = typeof n === 'bigint' ? Number(n) : n;
    if (num < challenge.numRange[0] || num > challenge.numRange[1]) return false;
  }
  if (gameMode === 'findLongest' && challenge) {
    const num = typeof n === 'bigint' ? Number(n) : n;
    if (num < challenge.lo || num > challenge.hi) return false;
  }

  currentNumber = n;
  selectedBucket = -1;

  if (gameMode === 'freeExplore') {
    // Skip prediction, go straight to launch
    currentSteps = stoppingTime(n);
    gameState = 'launch';
  } else if (gameMode === 'guessSteps') {
    gameState = 'predict';
  } else {
    // hitRange and findLongest don't need bucket prediction
    currentSteps = stoppingTime(n);
    gameState = 'launch';
  }
  return true;
}

export function selectBucket(index) {
  if (gameState !== 'predict') return;
  if (index < 0 || index >= BUCKETS.length) return;
  selectedBucket = index;
}

export function confirmLaunch() {
  if (gameMode === 'guessSteps') {
    if (gameState !== 'predict' || selectedBucket < 0) return null;
    currentSteps = stoppingTime(currentNumber);
    correctBucket = BUCKETS.findIndex(b => currentSteps >= b.min && currentSteps <= b.max);
    if (correctBucket < 0) correctBucket = BUCKETS.length - 1;
  }
  // For hitRange/findLongest/freeExplore, gameState is already 'launch'
  if (gameState !== 'predict' && gameState !== 'launch') return null;
  gameState = 'launch';
  return currentNumber;
}

export function onRunStart() {
  gameState = 'running';
}

// ── Run complete → score ────────────────────────────────
export function onRunComplete() {
  if (gameState !== 'running') return null;

  const tagEntry = RESULT_TAGS.find(t => currentSteps <= t.maxSteps) || RESULT_TAGS[RESULT_TAGS.length - 1];
  const peak = peakValue(currentNumber);
  let roundScore = 0;
  let verdictText = '';
  let verdictClass = '';

  if (gameMode === 'guessSteps') {
    const dist = Math.abs(selectedBucket - correctBucket);
    if (dist === 0) { roundScore = SCORE_EXACT; streak++; lastRoundCorrect = true; verdictText = '\u2705 Correct!'; verdictClass = 'correct'; }
    else if (dist === 1) { roundScore = SCORE_ADJACENT; streak = 0; lastRoundCorrect = false; verdictText = '\uD83D\uDD36 Close!'; verdictClass = 'close'; }
    else if (dist === 2) { roundScore = SCORE_TWO_AWAY; streak = 0; lastRoundCorrect = false; verdictText = '\u274C Missed'; verdictClass = 'miss'; }
    else { roundScore = SCORE_PARTICIPATION; streak = 0; lastRoundCorrect = false; verdictText = '\u274C Missed'; verdictClass = 'miss'; }

  } else if (gameMode === 'hitRange' && challenge) {
    const inBand = currentSteps >= challenge.stepBand[0] && currentSteps <= challenge.stepBand[1];
    if (inBand) { roundScore = SCORE_HIT_RANGE; streak++; lastRoundCorrect = true; verdictText = '\u2705 In range!'; verdictClass = 'correct'; }
    else { roundScore = SCORE_MISS_RANGE; streak = 0; lastRoundCorrect = false; verdictText = '\u274C Outside range'; verdictClass = 'miss'; }

  } else if (gameMode === 'findLongest' && challenge) {
    // Rank: how close to the best?
    const ratio = currentSteps / Math.max(1, challenge.bestSteps);
    if (currentSteps === challenge.bestSteps) { roundScore = SCORE_LONGEST_EXACT; streak++; lastRoundCorrect = true; verdictText = '\uD83C\uDFC6 Best possible!'; verdictClass = 'correct'; }
    else if (ratio >= 0.9) { roundScore = SCORE_LONGEST_TOP3; streak++; lastRoundCorrect = true; verdictText = '\u2B50 Top pick!'; verdictClass = 'correct'; }
    else if (ratio >= 0.7) { roundScore = SCORE_LONGEST_TOP10; streak = 0; lastRoundCorrect = false; verdictText = '\uD83D\uDD36 Good pick'; verdictClass = 'close'; }
    else { roundScore = SCORE_PARTICIPATION; streak = 0; lastRoundCorrect = false; verdictText = `Best was ${challenge.bestN} (${challenge.bestSteps} steps)`; verdictClass = 'miss'; }

  } else if (gameMode === 'freeExplore') {
    roundScore = 0;
    verdictText = '';
    verdictClass = '';
  }

  if (lastRoundCorrect && streak > 1) roundScore += (streak - 1) * STREAK_BONUS;

  lastRoundScore = roundScore;
  totalScore += roundScore;
  roundsPlayed++;
  saveScores();

  gameState = 'results';

  return {
    mode: gameMode,
    number: currentNumber,
    numberDisplay: formatValue(currentNumber),
    actualSteps: currentSteps,
    peakValue: peak,
    peakDisplay: formatValue(peak),
    guessedBucket: gameMode === 'guessSteps' ? BUCKETS[selectedBucket] : null,
    correctBucket: gameMode === 'guessSteps' ? BUCKETS[correctBucket] : null,
    challenge,
    isCorrect: lastRoundCorrect,
    roundScore,
    totalScore,
    streak,
    roundsPlayed,
    verdictText,
    verdictClass,
    tag: tagEntry.tag,
    tagIcon: tagEntry.icon,
    tagColor: tagEntry.color,
    highScore: getHighScore(),
    bestStreak: getBestStreak(),
  };
}

export function nextRound() {
  currentNumber = null;
  currentSteps = null;
  selectedBucket = -1;
  correctBucket = -1;
  challenge = null;
  gameState = 'idle';
}

export function cancelPrediction() {
  if (gameState === 'predict') {
    gameState = 'idle';
    currentNumber = null;
    selectedBucket = -1;
  }
}

export function resetGame() {
  nextRound();
  totalScore = 0;
  streak = 0;
  roundsPlayed = 0;
  lastRoundScore = 0;
  lastRoundCorrect = false;
  saveScores();
}

// Load saved scores on module init
loadScores();
