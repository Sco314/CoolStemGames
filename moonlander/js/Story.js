// Story.js — Batch 4 #10
// Per-level narrative arc that threads together the systems Batch 1–3 built:
//   - Intro brief on WalkMode entry (one Mission Control beat per site).
//   - Optional mid-mission nudge if the player wanders aimlessly (TODO: hook).
//   - Outro / commendation on the next successful landing for that level.
//   - One soft STEM challenge prompt if the player hasn't tried any yet.
//
// Beats are keyed by APOLLO_SITES.id so the registry rotates with the level.
// All beats are gated by GameState.flags so they fire at most once per save
// (intro/outro per level; nudges per session). Missing key = silent no-op so
// the game still runs even if the catalog is incomplete.

import { GameState, save as saveGameState } from './GameState.js';
import { apolloSiteForLevel } from './Constants.js';
import { showMissionMessage } from './HUD.js';

// Catalog. Each entry: { intro, outro }. Both fields are { title, body }.
// `intro` fires when the player first enters walk mode for that level (per
// save). `outro` fires when the player completes their first successful
// landing after visiting that level's Apollo site.
const STORY_BEATS = {
  'apollo-11': {
    intro: {
      title: 'CAPCOM',
      body:  'Tranquility Base. The Sea of Tranquility — flat, dark, and the easiest of the Apollo landings. Walk the perimeter, plant the flag, bring back two samples.'
    },
    outro: {
      title: 'MISSION CONTROL',
      body:  'Tranquility surveyed. Eagle is wheels-up. Houston gives you a good show.'
    }
  },
  'apollo-12': {
    intro: {
      title: 'CAPCOM',
      body:  'Ocean of Storms. Pinpoint landing target — Surveyor 3 is somewhere in this crater. Find a repair part on the way; the lander hull will thank you.'
    },
    outro: {
      title: 'MISSION CONTROL',
      body:  'Ocean of Storms wrapped. Snoopy logs another success.'
    }
  },
  'apollo-14': {
    intro: {
      title: 'CAPCOM',
      body:  'Fra Mauro Highlands. Rough terrain — Antares is your ride home. Habitat module nearby for a top-up if your suit is hurting.'
    },
    outro: {
      title: 'MISSION CONTROL',
      body:  'Fra Mauro complete. Shepard salutes the next crew up.'
    }
  },
  'apollo-15': {
    intro: {
      title: 'CAPCOM',
      body:  'Hadley-Apennine. Mountains and rilles — geology jackpot. Five samples banked across the career puts you in the rover club.'
    },
    outro: {
      title: 'MISSION CONTROL',
      body:  'Hadley logged. The science team is already drafting papers.'
    }
  },
  'apollo-16': {
    intro: {
      title: 'CAPCOM',
      body:  'Descartes Highlands. Lunar geology textbook fodder. Three repair parts stowed across the career proves you can keep a craft alive.'
    },
    outro: {
      title: 'MISSION CONTROL',
      body:  'Descartes wrapped. Orion lifts off — clean profile.'
    }
  },
  'apollo-17': {
    intro: {
      title: 'CAPCOM',
      body:  'Taurus-Littrow. Last of the Apollo missions. Bring it home with full hull AND full health for the commendation.'
    },
    outro: {
      title: 'MISSION CONTROL',
      body:  'Challenger is wheels-up. The Apollo program closes. From all of us at Houston: thank you, commander.'
    }
  }
};

// Soft STEM nudge — fires once per save, the second time the player enters
// walk mode without having solved any math challenges. Keeps the brand
// promise visible without nagging.
const STEM_NUDGE = {
  title: 'MISSION CONTROL',
  body:  'Quick math beat? Tap the STEM button (top-left). A right answer logs to your stats and earns the team back home a high-five.'
};

function flag(key) {
  GameState.flags = GameState.flags || {};
  return GameState.flags[key];
}

function setFlag(key, val) {
  GameState.flags = GameState.flags || {};
  GameState.flags[key] = val;
  try { saveGameState(); } catch { /* persist is best-effort */ }
}

/**
 * Fire the intro beat for the current level if not already shown.
 * Called from WalkMode.enter() after the level objectives load.
 * Slightly delayed so the player has settled into the scene before the
 * Mission Control panel appears.
 */
export function onWalkEnter() {
  const site = apolloSiteForLevel(GameState.level);
  if (!site) return;
  const beats = STORY_BEATS[site.id];
  if (!beats?.intro) return;
  const flagKey = `storyIntro:${site.id}`;
  if (flag(flagKey)) {
    maybeStemNudge();
    return;
  }
  setFlag(flagKey, true);
  setTimeout(() => {
    showMissionMessage(null, { title: beats.intro.title, body: beats.intro.body, ttl: 8000 });
  }, 900);
  // Don't pile a second message on top of the intro; nudge waits for the
  // next visit.
}

/**
 * Fire the outro beat for the just-completed level if not already shown.
 * Called from LanderMode.resolveLanding() after a successful landing.
 */
export function onLandingCompleted() {
  // The level the player just finished is the previous level: GameState.level
  // already advanced inside resolveLanding before this is called. So look one
  // back.
  const finishedLevel = Math.max(0, (GameState.level | 0) - 1);
  const site = apolloSiteForLevel(finishedLevel);
  if (!site) return;
  const beats = STORY_BEATS[site.id];
  if (!beats?.outro) return;
  const flagKey = `storyOutro:${site.id}`;
  if (flag(flagKey)) return;
  setFlag(flagKey, true);
  setTimeout(() => {
    showMissionMessage(null, { title: beats.outro.title, body: beats.outro.body, ttl: 8000 });
  }, 1200);
}

function maybeStemNudge() {
  const solved = (GameState.stats?.mathSolved | 0);
  if (solved > 0) return;
  if (flag('storyStemNudge')) return;
  // Track entry count so the nudge waits for the second visit instead of
  // landing on the very first walk session (which is already busy).
  const visits = ((GameState.flags?.walkVisits | 0) + 1);
  setFlag('walkVisits', visits);
  if (visits < 2) return;
  setFlag('storyStemNudge', true);
  setTimeout(() => {
    showMissionMessage(null, { title: STEM_NUDGE.title, body: STEM_NUDGE.body, ttl: 7000 });
  }, 1400);
}
