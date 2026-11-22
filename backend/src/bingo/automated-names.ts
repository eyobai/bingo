import { createHash } from 'node:crypto';

/**
 * Display names for automated players: Ethiopian first names (Latin spelling), from the operator's list.
 * They are always shown with the automated label (🤖 … (automated)) so nobody mistakes them for real people.
 */
export const AUTOMATED_NAMES: string[] = [
  'Aduñahbzu', 'Asayehe-ñ', 'Amensisa', 'Aregahe-ñ', 'Asegahe-ñ', 'Asresahe-ñ', 'Alemneh', 'Abay', 'Akalaeneh', 'Alehe-ñ',
  'Atsineh', 'Ambaneh', 'Alganeh', 'Anteneh', 'Ametemeekaael', 'Ameteweld', 'Elfneh', 'Erqneh', 'Eesa', 'Esatu',
  'Eshet', 'Enqweslase', 'Enqwe', 'Estnfase', 'Ezezuñ', 'Feqadaeneh', 'Fentaneh', 'Feqade', 'Fesesu', 'Fetenu',
  'Firaew', 'Felege', 'Gezahe-ñ', 'Gosayaeneh', 'Girmayaeneh', 'Gaetaeneh', 'Gemaneh', 'Gebeyaneh', 'Gaetaneh', 'Giroom',
  'Gesgs', 'Gosa', 'Hagerneha', 'Hiyalneh', 'Huneña', 'Habtamoo', 'Habte', 'Jember', 'Jafar', 'Jibril',
  'Jabeer', 'Jemal', 'Jemeel', 'Jema', 'Jemberoo', 'Jemberae', 'Jebdu', 'Kasaneh', 'Kindneh', 'Kale',
  'Kal', 'Kinfe', 'Likyelehm', 'Leyeh', 'Leyehe-ñ', 'Leganeh', 'Lisane', 'Lalem', 'Liookan', 'Liool',
  'Lisanu', 'Meleskachew', 'Melkamneh', 'Moolooneh', 'Melaneh', 'Mitkneh', 'Menkr', 'Man', 'Niway', 'Nafequ',
  'Nebeeyaloo', 'Nebroo', 'Nigusu', 'Nolawi', 'Nibab', 'Noh', 'Niqodimos', 'Negedae', 'Omer', 'Osman',
  'Pawlos', 'Petros', 'Qaleyesus', 'Qale', 'Qaloo', 'Qaleab', 'Qumbachew', 'Qumlachew', 'Remedan', 'Robael',
  'Reda', 'Reta', 'Roofaael', 'Resteen', 'Reshid', 'Rewazee', 'Rezene', 'Redi', 'Semahe-ñ', 'Selamneh',
  'Semae', 'Sewneh', 'Simeñ', 'Sinshaw', 'Sinafqh', 'Sidell', 'Sint', 'Tekeste', 'Tsehayneh', 'Tigneh',
  'Tamroo', 'Tiroo', 'Teamrneh', 'Tesfaneh', 'Tseganeh', 'Tomas', 'Timotaewos', 'Tashu', 'Tebeebu', 'Taenaw',
  'Zekaryas', 'Zerfeshiwal', 'Zemedaeneh', 'Zerfneh', 'Zera', 'Zedagm', 'Zinabu', 'Zaegaw', 'Zeroo', 'Zewdu',
  'Zergaw', 'Yeshum', 'Yene', 'Yetemeñu', 'Yusuf', 'Yektneh', 'Yigletu', 'Yitagesu', 'Yirefu', 'Yitatequ',
  'Yigebroo', 'Yigardu', 'Yifroo', 'Yinadu', 'Yichenequ', 'Yirgu', 'Yigezu', 'Bezabh', 'Bezu', 'Baezachew',
  'Betroo', 'Baryaw', 'Biroo', 'Bahroo', 'Birqu', 'Birhanesegen', 'Bealoo', 'Birzaf', 'Bahre',
];

/**
 * The name of automated player `owner` (1, 2, …) in a round. Each round gets its own random-looking order from
 * the round id, so names change between rounds but stay the same within one (also after a restart). Players in
 * the same round never share a name; past the list, a number is added (Abay 2).
 */
export function automatedName(roundId: string, owner: number): string {
  const n = AUTOMATED_NAMES.length;
  const order = Array.from({ length: n }, (_, i) => i);
  let seed = createHash('sha256').update(roundId).digest();
  for (let i = n - 1; i > 0; i--) {
    if (i % 15 === 0) seed = createHash('sha256').update(seed).digest(); // fresh bytes for long lists
    const j = seed.readUInt16BE((i * 2) % (seed.length - 1)) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const base = AUTOMATED_NAMES[order[(owner - 1) % n]];
  const lap = Math.floor((owner - 1) / n);
  return lap ? `${base} ${lap + 1}` : base;
}
