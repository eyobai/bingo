#!/usr/bin/env node
/**
 * Makes the 75 ball announcements ("ቢ አምስት" for B5) as MP3 files in public/sounds/am/, using
 * Microsoft Azure's Amharic male voice "Ameha" (am-ET-AmehaNeural).
 *
 * 1. Create a free Speech resource in the Azure portal (Free F0 tier: 500,000 characters a month; this
 *    script uses about 1,000) and copy its key and region (e.g. "eastus").
 * 2. Run, from the miniapp folder:
 *      PowerShell:  $env:AZURE_SPEECH_KEY="..."; $env:AZURE_SPEECH_REGION="eastus"; node scripts/make-calls.mjs
 *      bash:        AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=eastus node scripts/make-calls.mjs
 *
 * Options:
 *   --list            only print what will be said for each ball (no key needed)
 *   --force           remake files that already exist
 *   --voice NAME      another voice, e.g. am-ET-MekdesNeural (female)
 *   --rate PERCENT    speaking speed, e.g. 10 for 10% faster (default 0)
 *   --only 5,30,75    make just these balls (to redo a few)
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** How bingo callers say the column letters in Amharic. */
const LETTER_WORDS = { B: 'ቢ', I: 'አይ', N: 'ኤን', G: 'ጂ', O: 'ኦ' };
const ONES = ['', 'አንድ', 'ሁለት', 'ሶስት', 'አራት', 'አምስት', 'ስድስት', 'ሰባት', 'ስምንት', 'ዘጠኝ'];
const TENS = ['', 'አስር', 'ሃያ', 'ሰላሳ', 'አርባ', 'ሃምሳ', 'ስልሳ', 'ሰባ'];

/** 1..75 in Amharic words: 5 "አምስት", 15 "አስራ አምስት", 30 "ሰላሳ", 46 "አርባ ስድስት". */
export function amharicNumber(n) {
  if (n < 10) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  if (tens === 1) return ones ? `አስራ ${ONES[ones]}` : 'አስር';
  return ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens];
}

const letterOf = (n) => 'BINGO'[Math.floor((n - 1) / 15)];
const fileOf = (n) => `${letterOf(n).toLowerCase()}${n}.mp3`;
export const phrase = (n) => `${LETTER_WORDS[letterOf(n)]}፣ ${amharicNumber(n)}`;

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sounds', 'am');
const balls = option('only')
  ? option('only').split(',').map(Number).filter((n) => n >= 1 && n <= 75)
  : Array.from({ length: 75 }, (_, i) => i + 1);

if (flag('list')) {
  for (const n of balls) console.log(`${letterOf(n)}${String(n).padEnd(3)} ${fileOf(n).padEnd(9)} ${phrase(n)}`);
  process.exit(0);
}

const key = process.env.AZURE_SPEECH_KEY;
const region = process.env.AZURE_SPEECH_REGION;
if (!key || !region) {
  console.error('Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION first (see the top of this file).');
  process.exit(1);
}
const voice = option('voice') ?? 'am-ET-AmehaNeural';
const rate = Number(option('rate') ?? 0);
mkdirSync(outDir, { recursive: true });

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const ssml = (n) => `<speak version="1.0" xml:lang="am-ET"><voice name="${voice}"><prosody rate="${rate >= 0 ? '+' : ''}${rate}%">${escapeXml(LETTER_WORDS[letterOf(n)])}<break time="200ms"/>${escapeXml(amharicNumber(n))}</prosody></voice></speak>`;

let made = 0;
for (const n of balls) {
  const file = join(outDir, fileOf(n));
  if (existsSync(file) && !flag('force')) continue;
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'bingo-call-maker',
    },
    body: ssml(n),
  });
  if (!res.ok) {
    console.error(`${fileOf(n)}: Azure answered ${res.status} ${await res.text()}`);
    if (res.status === 401) console.error('The key or region is wrong.');
    process.exit(1);
  }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  made++;
  console.log(`${fileOf(n).padEnd(9)} ${phrase(n)}`);
  await new Promise((r) => setTimeout(r, 120)); // stay well under the free tier's rate limit
}
console.log(`\nDone: ${made} new file(s) in ${outDir}`);
