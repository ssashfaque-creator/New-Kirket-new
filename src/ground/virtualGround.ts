export type GroundPreset = {
  id: string;
  name: string;
  description: string;
  straightBoundaryM: number;
  squareBoundaryM: number;
};

export type FieldingPosition = {
  id: string;
  label: string;
  angleDegrees: number;
  distanceM: number;
  catching?: boolean;
};

export type FieldPreset = {
  id: string;
  name: string;
  bowlingStyle: "pace" | "spin" | "balanced";
  aggression: "attacking" | "balanced" | "defensive";
  description: string;
  positions: FieldingPosition[];
};

export const GROUND_PRESETS: GroundPreset[] = [
  {
    id: "backyard-compact",
    name: "Backyard compact",
    description: "Small training ground for tight net-to-boundary simulation.",
    straightBoundaryM: 45,
    squareBoundaryM: 38,
  },
  {
    id: "school-oval",
    name: "School oval",
    description: "Small community field with short square boundaries.",
    straightBoundaryM: 55,
    squareBoundaryM: 48,
  },
  {
    id: "club-small",
    name: "Club small",
    description: "Typical compact club boundary.",
    straightBoundaryM: 62,
    squareBoundaryM: 55,
  },
  {
    id: "dubai-style",
    name: "Dubai style",
    description: "Balanced modern stadium dimensions.",
    straightBoundaryM: 70,
    squareBoundaryM: 63,
  },
  {
    id: "lords-style",
    name: "Lord's style",
    description: "Longer straight hit, slightly shorter square hit.",
    straightBoundaryM: 75,
    squareBoundaryM: 60,
  },
  {
    id: "mcg-large",
    name: "MCG large",
    description: "Large oval with long square and straight boundaries.",
    straightBoundaryM: 82,
    squareBoundaryM: 78,
  },
  {
    id: "adelaide-oval",
    name: "Adelaide oval",
    description: "Long straight pockets with narrower square shape.",
    straightBoundaryM: 82,
    squareBoundaryM: 64,
  },
  {
    id: "eden-gardens",
    name: "Eden Gardens style",
    description: "Large subcontinental-style oval.",
    straightBoundaryM: 76,
    squareBoundaryM: 70,
  },
  {
    id: "wankhede",
    name: "Wankhede style",
    description: "Fast-scoring ground with reachable boundaries.",
    straightBoundaryM: 68,
    squareBoundaryM: 60,
  },
  {
    id: "custom-practice-large",
    name: "Practice large",
    description: "Large training environment for full-power shots.",
    straightBoundaryM: 90,
    squareBoundaryM: 82,
  },
];

export const FIELD_PRESETS: FieldPreset[] = [
  {
    id: "powerplay-pace",
    name: "Powerplay pace attack",
    bowlingStyle: "pace",
    aggression: "attacking",
    description: "Two slips plus ring fielders to reward clean gaps.",
    positions: [
      pos("keeper", "WK", 180, 18, true),
      pos("slip1", "1st slip", 205, 22, true),
      pos("slip2", "2nd slip", 220, 24, true),
      pos("point", "Point", 265, 32),
      pos("cover", "Cover", 305, 34),
      pos("mid-off", "Mid-off", 340, 38),
      pos("mid-on", "Mid-on", 20, 38),
      pos("square-leg", "Square leg", 95, 35),
      pos("fine-leg", "Fine leg", 135, 52),
      pos("third", "Third", 225, 55),
      pos("bowler", "Bowler", 0, 18),
    ],
  },
  {
    id: "t20-defensive",
    name: "T20 defensive spread",
    bowlingStyle: "balanced",
    aggression: "defensive",
    description: "Boundary riders protect common scoring zones.",
    positions: [
      pos("keeper", "WK", 180, 18, true),
      pos("deep-third", "Deep third", 225, 62),
      pos("deep-point", "Deep point", 270, 62),
      pos("deep-cover", "Deep cover", 315, 64),
      pos("long-off", "Long-off", 350, 67),
      pos("long-on", "Long-on", 10, 67),
      pos("deep-midwicket", "Deep midwicket", 55, 64),
      pos("deep-square", "Deep square", 95, 62),
      pos("fine-leg", "Fine leg", 140, 58),
      pos("extra-cover", "Extra cover", 325, 34),
      pos("bowler", "Bowler", 0, 18),
    ],
  },
  {
    id: "spin-attack",
    name: "Spin attacking",
    bowlingStyle: "spin",
    aggression: "attacking",
    description: "Close catchers and ring pressure for spin practice.",
    positions: [
      pos("keeper", "WK", 180, 16, true),
      pos("slip", "Slip", 210, 18, true),
      pos("leg-slip", "Leg slip", 150, 17, true),
      pos("short-leg", "Short leg", 115, 12, true),
      pos("silly-point", "Silly point", 255, 12, true),
      pos("cover", "Cover", 305, 30),
      pos("mid-off", "Mid-off", 345, 32),
      pos("mid-on", "Mid-on", 20, 32),
      pos("deep-midwicket", "Deep midwicket", 55, 62),
      pos("long-off", "Long-off", 350, 64),
      pos("bowler", "Bowler", 0, 15),
    ],
  },
  {
    id: "odi-balanced",
    name: "ODI balanced",
    bowlingStyle: "balanced",
    aggression: "balanced",
    description: "Mix of ring field and boundary protection.",
    positions: [
      pos("keeper", "WK", 180, 18, true),
      pos("slip", "Slip", 212, 22, true),
      pos("point", "Point", 270, 34),
      pos("cover", "Cover", 310, 36),
      pos("mid-off", "Mid-off", 345, 38),
      pos("mid-on", "Mid-on", 20, 38),
      pos("square-leg", "Square leg", 95, 36),
      pos("fine-leg", "Fine leg", 140, 58),
      pos("deep-cover", "Deep cover", 315, 64),
      pos("long-on", "Long-on", 10, 67),
      pos("bowler", "Bowler", 0, 18),
    ],
  },
  {
    id: "test-ring",
    name: "Test match ring",
    bowlingStyle: "pace",
    aggression: "balanced",
    description: "Traditional ring with catching cordon.",
    positions: [
      pos("keeper", "WK", 180, 18, true),
      pos("slip1", "1st slip", 205, 22, true),
      pos("slip2", "2nd slip", 220, 24, true),
      pos("gully", "Gully", 240, 28, true),
      pos("point", "Point", 270, 34),
      pos("cover", "Cover", 310, 35),
      pos("mid-off", "Mid-off", 345, 36),
      pos("mid-on", "Mid-on", 20, 36),
      pos("square-leg", "Square leg", 95, 35),
      pos("fine-leg", "Fine leg", 140, 55),
      pos("bowler", "Bowler", 0, 18),
    ],
  },
  {
    id: "leg-side-trap",
    name: "Leg-side trap",
    bowlingStyle: "pace",
    aggression: "attacking",
    description: "Packed leg side for short-ball and bodyline practice.",
    positions: [
      pos("keeper", "WK", 180, 18, true),
      pos("leg-slip", "Leg slip", 150, 18, true),
      pos("short-leg", "Short leg", 110, 13, true),
      pos("square-leg", "Square leg", 90, 32),
      pos("deep-square", "Deep square", 95, 62),
      pos("fine-leg", "Fine leg", 140, 58),
      pos("deep-midwicket", "Deep midwicket", 55, 64),
      pos("mid-on", "Mid-on", 20, 34),
      pos("mid-off", "Mid-off", 345, 38),
      pos("third", "Third", 225, 55),
      pos("bowler", "Bowler", 0, 18),
    ],
  },
];

export function boundaryRadiusAtAngle(ground: GroundPreset, angleDegrees: number): number {
  const radians = (angleDegrees * Math.PI) / 180;
  const x = Math.sin(radians);
  const y = Math.cos(radians);
  const a = ground.squareBoundaryM;
  const b = ground.straightBoundaryM;
  return 1 / Math.sqrt((x * x) / (a * a) + (y * y) / (b * b));
}

function pos(
  id: string,
  label: string,
  angleDegrees: number,
  distanceM: number,
  catching = false,
): FieldingPosition {
  return { id, label, angleDegrees, distanceM, catching };
}
