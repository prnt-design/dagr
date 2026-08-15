import type { Rng } from './random.js';

/**
 * Deterministic fantasy naming, from syllable and word tables.
 *
 * The tables are sized for the default campaign: roughly 950 places and 550
 * people need names that mostly do not repeat, and the products below give
 * about 3,000 distinct settlements and 40,000 distinct people before
 * {@link NameBook} has to start numbering. Numbering is the fallback, not a
 * bug: "Fenmoor II" is how real map-makers solved the same collision.
 *
 * Nothing here is Wizards of the Coast material: every table is original, so
 * the dataset ships without a licensing question.
 */

const PLACE_HEADS = [
  'Fen', 'Mor', 'Thorn', 'Ash', 'Grim', 'Dun', 'Kar', 'Vel', 'Bryn', 'Hol',
  'Ista', 'Ravn', 'Sable', 'Wyr', 'Cal', 'Drav', 'Elder', 'Gable', 'Mist', 'Oster',
];

const PLACE_TAILS = [
  'moor', 'dale', 'ford', 'heim', 'crest', 'watch', 'mere', 'burg', 'fell', 'hollow',
  'march', 'reach', 'haven', 'gate', 'wick', 'ley', 'holt', 'stead', 'garde', 'shore',
];

const REGION_STYLES = [
  'the %s Marches', 'the %s Expanse', 'the Vale of %s', 'the %s Wilds',
  'the %s Coast', 'the %s Highlands',
];

const TERRAIN = [
  'forest', 'marsh', 'hills', 'coast', 'plains', 'mountains', 'badlands', 'tundra',
];

const PERSON_FIRST = [
  'Ael', 'Bran', 'Cor', 'Dara', 'Ed', 'Fael', 'Gwen', 'Hal', 'Isol', 'Jor',
  'Kira', 'Lund', 'Mara', 'Ned', 'Ola', 'Pell', 'Quin', 'Rosa', 'Sten', 'Tam',
];

const PERSON_FIRST_TAIL = [
  'a', 'an', 'ric', 'wen', 'mund', 'is', 'or', 'eth', 'ild', 'as',
];

const PERSON_LAST_HEAD = [
  'Black', 'Iron', 'Raven', 'Storm', 'Ember', 'Frost', 'Gold', 'Moss', 'Night', 'Salt',
];

const PERSON_LAST_TAIL = [
  'brook', 'mantle', 'shield', 'wood', 'bane', 'whistle', 'hollow', 'spear', 'field', 'song',
];

const ROLES = [
  'innkeeper', 'smith', 'captain of the watch', 'herbalist', 'fence', 'priest',
  'scribe', 'hunter', 'merchant', 'gravedigger', 'ferryman', 'alchemist',
  'stablemaster', 'moneylender', 'cartographer', 'beggar who sees everything',
];

const SITE_KINDS = [
  'Crypt', 'Spire', 'Vault', 'Catacombs', 'Temple', 'Keep', 'Warrens', 'Sanctum',
  'Mine', 'Barrow',
];

const BUILDING_KINDS = [
  'inn', 'temple', 'guildhall', 'manor', 'warehouse', 'watchtower', 'bathhouse',
  'archive', 'market hall', 'apothecary',
];

const ROOM_KINDS = [
  'antechamber', 'great hall', 'cellar', 'gallery', 'shrine', 'barracks',
  'library', 'kitchen', 'crypt', 'landing', 'workshop', 'cistern', 'vestibule',
  'storeroom', 'study', 'oubliette',
];

const ADJECTIVES = [
  'Gilded', 'Sunken', 'Silent', 'Crooked', 'Weeping', 'Hollow', 'Burnt',
  'Wandering', 'Pale', 'Thrice-Locked', 'Drowned', 'Last',
];

const FACTION_SHAPES = [
  'the Order of the %s', 'the %s Circle', 'the Court of %s', 'the %s Compact',
  'the Wardens of %s', 'the %s League',
];

const FACTION_SUBJECTS = [
  'Broken Crown', 'Grey Lantern', 'Silver Bough', 'Red Tide', 'Open Hand',
  'Sealed Door', 'Long Winter', 'Nine Bells', 'Low Road', 'Quiet Ledger',
  'Ashen Veil', 'First Dawn',
];

const QUEST_VERBS = [
  'Recover', 'Escort', 'Unmask', 'Break the siege of', 'Map', 'Bargain for',
  'Steal back', 'Bury', 'Ransom', 'Cleanse',
];

const ITEM_KINDS = [
  'blade', 'lantern', 'signet', 'reliquary', 'cloak', 'ledger', 'chalice',
  'compass', 'mask', 'key',
];

const MONSTERS = [
  'goblin', 'skeleton', 'bandit', 'wolf', 'cultist', 'ghoul', 'ogre', 'wight',
  'harpy', 'basilisk', 'troll', 'wraith', 'chimera', 'lich', 'dragon',
];

const OMENS = [
  'the wells turn bitter', 'cattle are born eyeless', 'the roads empty at dusk',
  'strangers buy up old debts', 'the tide forgets to turn', 'bells ring with no ringer',
  'the crows leave', 'letters arrive already opened',
];

const SKILLS = [
  'Persuasion', 'Stealth', 'Athletics', 'Investigation', 'Arcana', 'Survival',
  'Deception', 'Insight',
];

/**
 * Hands out names, guaranteeing uniqueness inside each namespace by
 * numbering a collision: the third "Fenmoor" is "Fenmoor III". Namespaces
 * keep a settlement from stealing a person's numbering.
 */
export class NameBook {
  readonly #used = new Map<string, number>();

  unique(namespace: string, candidate: string): string {
    const key = `${namespace}:${candidate}`;
    const seen = this.#used.get(key) ?? 0;
    this.#used.set(key, seen + 1);
    if (seen === 0) return candidate;
    const numerals = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    const numeral = numerals[seen - 1];
    return numeral === undefined ? `${candidate} ${String(seen + 1)}` : `${candidate} ${numeral}`;
  }
}

export function placeName(rng: Rng): string {
  return rng.pick(PLACE_HEADS) + rng.pick(PLACE_TAILS);
}

export function regionName(rng: Rng): string {
  return rng.pick(REGION_STYLES).replace('%s', placeName(rng));
}

export function terrainKind(rng: Rng): string {
  return rng.pick(TERRAIN);
}

export function personName(rng: Rng): string {
  const first = rng.pick(PERSON_FIRST) + rng.pick(PERSON_FIRST_TAIL);
  return `${first} ${rng.pick(PERSON_LAST_HEAD)}${rng.pick(PERSON_LAST_TAIL)}`;
}

export function personRole(rng: Rng): string {
  return rng.pick(ROLES);
}

export function dungeonName(rng: Rng): string {
  return `the ${rng.pick(ADJECTIVES)} ${rng.pick(SITE_KINDS)} of ${placeName(rng)}`;
}

export function buildingName(rng: Rng): string {
  const kind = rng.pick(BUILDING_KINDS);
  return kind === 'inn'
    ? `the ${rng.pick(ADJECTIVES)} ${rng.pick(ITEM_KINDS)}`
    : `the ${rng.pick(ADJECTIVES).toLowerCase()} ${kind}`;
}

export function roomName(rng: Rng): string {
  return `${rng.pick(ADJECTIVES).toLowerCase()} ${rng.pick(ROOM_KINDS)}`;
}

export function factionName(rng: Rng): string {
  return rng.pick(FACTION_SHAPES).replace('%s', rng.pick(FACTION_SUBJECTS));
}

export function questName(rng: Rng, subject: string): string {
  return `${rng.pick(QUEST_VERBS)} ${subject}`;
}

export function itemName(rng: Rng): string {
  return `the ${rng.pick(ADJECTIVES)} ${rng.pick(ITEM_KINDS)}`;
}

export function monsterName(index: number): string {
  const base = MONSTERS[index % MONSTERS.length] ?? 'beast';
  // Eight prefix tiers over fifteen bases is 135 distinct names, which covers
  // the 130-statblock bestiary without falling back to NameBook numbering:
  // the numbering fallback exists for rare collisions, not for the whole top
  // half of a table.
  const prefixes = ['elder', 'dread', 'ancient', 'fell', 'primal', 'spectral', 'abyssal', 'crowned'];
  const tier = Math.floor(index / MONSTERS.length);
  if (tier === 0) return base;
  const prefix = prefixes[(tier - 1) % prefixes.length] ?? 'ancient';
  return `${prefix} ${base}`;
}

export function omen(rng: Rng): string {
  return rng.pick(OMENS);
}

export function skillCheckSkill(rng: Rng): string {
  return rng.pick(SKILLS);
}
