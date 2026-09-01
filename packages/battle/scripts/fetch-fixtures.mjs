#!/usr/bin/env node
/**
 * Pulls a small, diverse sample of real public replays from Showdown's
 * replay server and saves them as regression fixtures.
 *
 * These are a snapshot, not a permanently authoritative corpus: rerun this
 * whenever the fixtures should be refreshed (e.g. after a new generation
 * ships, or a battle-state bug report points at a format not yet covered).
 *
 * Deliberately spans singles/doubles, current/old generations, and
 * ladder/random formats — that spread is the point: a client that only
 * replays gen9ou correctly still fails the moment someone opens an old
 * generation's battle or a randbats match.
 */

import { mkdir, writeFile } from 'node:fs/promises';

const FORMATS = ['gen9ou', 'gen9randombattle', 'gen9doublesou', 'gen8ou', 'gen1ou'];
const PER_FORMAT = 6;
const OUT_DIR = new URL('../fixtures/', import.meta.url);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJSON(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'showdown-mobile-fixture-fetcher (dev tooling)' },
  });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  let text = await response.text();
  // Showdown prefixes some JSON endpoints with `]` as an anti-hijacking
  // measure (the same convention @pkmn/login strips from login responses).
  if (text.startsWith(']')) text = text.slice(1);
  return JSON.parse(text);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let saved = 0;
  for (const format of FORMATS) {
    const results = await fetchJSON(
      `https://replay.pokemonshowdown.com/api/replays/search?format=${format}`,
    );
    const candidates = results.filter(r => r.private === 0 && !r.password).slice(0, PER_FORMAT);

    if (candidates.length === 0) {
      console.warn(`No public replays found for ${format}, skipping.`);
      continue;
    }

    for (const candidate of candidates) {
      const replay = await fetchJSON(`https://replay.pokemonshowdown.com/${candidate.id}.json`);
      // Trimmed to what the corpus test actually needs: player names, ratings
      // and upload times aren't relevant to state-machine correctness and
      // don't need to live in the repo.
      const fixture = { id: replay.id, formatid: replay.formatid, log: replay.log };
      await writeFile(
        new URL(`${replay.id}.json`, OUT_DIR),
        JSON.stringify(fixture, null, 2) + '\n',
      );
      saved++;
      console.log(`saved ${replay.id} (${replay.formatid}, ${replay.log.split('\n').length} lines)`);
      await sleep(300); // don't hammer the replay server
    }
  }

  console.log(`\nSaved ${saved} fixtures to ${OUT_DIR.pathname}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
