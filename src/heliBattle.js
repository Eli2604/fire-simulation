/**
 * The helicopter battle (scenarios.js 'heliBattle'): the carrier's world (its flight deck, the
 * islands, the camp island's military base) with a fight in it, a while after you arrive.
 *
 *  - Off the carrier (the flight deck's place): a pair of blue armed helicopters (escort: 20 mm
 *    chin guns, rockets, two heat seekers each, door gunners) on a combat air patrol over the sea
 *    north of the ship, and a pair of red attack helicopters coming in from the north-east: they
 *    find each other (their crews' sight: ai/helicopter.js), a turning fight, missiles and flares
 *    (ai/heliCombat.js, ai/heliArms.js); the losers come down in the sea.
 *  - At the military base (the camp island): a blue convoy (a jeep with a 12.7 mm on the roof and
 *    a truck, crewed) drives across the landing ground behind the ridge, two blue motor boats
 *    (one with a machine gun in the bow) lie off the east shore; a red gunship comes over the base
 *    from the west and hunts them (rocket dives, its cannon from a standoff), and you, if you are
 *    out there; the jeep's gunner and the boats shoot back. On the landing ground an armed blue
 *    attack helicopter stands ready for you (E at its cockpit: Space the gun, click rockets, T a
 *    missile once locked, F flares).
 *
 * Everything here is ordinary objects with their params (models/helicopter.js armament, mission
 * 'hunt', startAfter; models/car.js and models/rowBoat.js side, mountedGun, crewMen), so the
 * editor shows and changes them; only the place you are in is simulated, the others wait.
 */

/** The air battle off the carrier (the deck zone's frame: the ship's middle at x 106, z 26; the sea at 4.5 m). */
export function airBattleObjects() {
  const lz = { x: 106, z: -380 };
  const heli = (params) => ({ type: 'helicopter', params: { mission: 'hunt', start: 'air', altitude: 90, orbitRadius: 380, engageR: 3500, cruise: 45, hoverAlt: 12, ropeLength: 20, ...params }, ...lz, rotation: 0 });
  return [
    heli({ side: 'friendly', armament: 'escort', soldiers: 2, doorGuns: 'both', callsign: 'Viper', color: '#3d4a52', fromX: -40, fromZ: 380, startAfter: 20, seed: 11 }),
    heli({ side: 'friendly', armament: 'escort', soldiers: 2, doorGuns: 'both', callsign: 'Hawk', color: '#3d4a52', fromX: 60, fromZ: 400, startAfter: 22, seed: 12 }),
    heli({ side: 'enemy', armament: 'attack', soldiers: 0, doorGuns: 'none', callsign: 'Raven', color: '#5a4a3a', fromX: 1500, fromZ: -1500, startAfter: 25, seed: 13 }),
    heli({ side: 'enemy', armament: 'attack', soldiers: 0, doorGuns: 'none', callsign: 'Dustoff', color: '#5a4a3a', fromX: 1650, fromZ: -1380, startAfter: 27, seed: 14 }),
  ];
}

/** The attack on the convoy and the boats at the military base (the camp zone's frame: the landing ground at ~x 94–112, z 28–72; the sea east of x 115 at 3 m). */
export function convoyAttackObjects() {
  const car = (params, x, z, rotation) => ({ type: 'car', params: { side: 'blue', ...params }, x, z, y: 'auto', rotation });
  const boat = (params, x, z) => ({ type: 'motorBoat', params: { side: 'blue', moored: true, mooring: 3, crewMen: 2, label: 'Blue patrol boat', hullColor: '#46525a', length: 5.2, beam: 1.9, depth: 0.85, ...params }, x, z, y: 2.5, rotation: 90 });
  return [
    // the convoy: the jeep ahead (a 12.7 mm on its roof, three men: the last on the gun) moving up, the
    // truck halted behind (a 5.5 m truck set moving spills its fuel at once: a car-body bug to look at)
    car({ length: 4.4, width: 1.9, height: 1.9, bodyColor: '#4b5a3a', fuelLiters: 60, mountedGun: 'hmg', crewMen: 3, driveToX: 101, driveToZ: 68 }, 97, 44, -90),
    car({ length: 5.5, width: 2.2, height: 2, bodyColor: '#4b5a3a', fuelLiters: 80, tankMaterial: 'steel', crewMen: 2 }, 97, 34, -90),
    // two patrol boats off the east shore, one with a machine gun in its bow
    boat({ mountedGun: 'mg', seed: 3 }, 121, 46),
    boat({ seed: 4 }, 122, 30),
    // the red gunship: over the base from the west, a while after you arrive
    { type: 'helicopter', params: { side: 'enemy', mission: 'hunt', armament: 'gunship', start: 'air', soldiers: 0, doorGuns: 'none', callsign: 'Hawk', color: '#5a4a3a', fromX: -950, fromZ: -260, altitude: 70, orbitRadius: 230, engageR: 1800, startAfter: 40, seed: 21 }, x: 104, z: 50, rotation: 0 },
    // yours: an armed attack helicopter on the landing ground (E at its cockpit)
    { type: 'helicopter', params: { side: 'friendly', mission: 'hover', armament: 'attack', start: 'ground', autoStart: false, soldiers: 2, doorGuns: 'both', callsign: 'Viper', color: '#3d4a52', fromX: 0, fromZ: 0, seed: 22 }, x: 106, z: 34, rotation: 0 },
  ];
}

/** The carrier's world (a copy: scenarios.js cloneScene) with the battle in it. */
export function heliBattleScene(carrier) {
  const sc = carrier;
  sc.name = 'Helicopter battle: carrier and military base';
  sc.description =
    'The carrier\'s world with a fight in it. Twenty seconds in, two blue armed helicopters take off on patrol over the sea north of the ship, and two red attack helicopters come in from the north-east: their crews pick each other out, they close and turn after each other, fire their chin guns and heat-seeking missiles, drop flares against them, break off when hit, and go home when out of ammunition. Over at the military base on the camp island (the places list, or zoom out and click it) a blue convoy, a jeep with a heavy machine gun on its roof and a truck, crosses the landing ground behind the ridge and two blue patrol boats lie off the east shore; forty seconds after you get there a red gunship comes over the base from the west and hunts them with rockets and its cannon (and you, if it sees you): the jeep\'s gunner and the boat\'s fire back, a hit fuel tank burns and bursts, holed boats fill and sink. An armed blue attack helicopter stands on the landing ground for you: E at its cockpit, W/S collective, the mouse the cyclic, A/D the pedals, Space its gun (onto the identified target nearest the nose), a click a pair of rockets, T a missile once the seeker has locked (keep the nose on it), F flares. ' +
    'Everything else in the world is as in the carrier scene.';
  sc.zones.deck.objects = [...sc.zones.deck.objects, ...airBattleObjects()];
  sc.zones.camp.objects = [...sc.zones.camp.objects, ...convoyAttackObjects()];
  return sc;
}
