export const BAT_LENGTH_INCHES = 33.5;
export const STUMP_HEIGHT_INCHES = 28;
export const WICKET_WIDTH_INCHES = 9;
export const POPPING_CREASE_DISTANCE_INCHES = 48;
export const CRICKET_PITCH_LENGTH_INCHES = 792;
export const BOWLING_CREASE_HALF_WIDTH_INCHES = 52;
export const POPPING_CREASE_HALF_WIDTH_INCHES = 72;
export const PITCH_HALF_WIDTH_INCHES = 60;
export const RETURN_CREASE_FORWARD_INCHES = 96;
export const NET_TURF_WIDTH_INCHES = 156;

export const DEFAULT_CAMERA_FOV_DEGREES = 67;
export const MIN_POSE_POINTS = 6;

export const LANDMARK_ORDER = [
  "middleStumpBase",
  "middleStumpTop",
  "offStumpBase",
  "offStumpTop",
  "legStumpBase",
  "legStumpTop",
  "batTip",
  "turfBackLeft",
  "turfBackRight",
  "creaseLeft",
  "creaseRight",
] as const;

export const LANDMARK_LABELS: Record<(typeof LANDMARK_ORDER)[number], string> = {
  middleStumpBase: "Middle stump base / bat toe",
  middleStumpTop: "Middle stump top",
  offStumpBase: "Off stump base",
  offStumpTop: "Off stump top",
  legStumpBase: "Leg stump base",
  legStumpTop: "Leg stump top",
  batTip: "Far end of 33.5 in bat",
  turfBackLeft: "Back turf edge left (13 ft)",
  turfBackRight: "Back turf edge right (13 ft)",
  creaseLeft: "Left point on popping crease",
  creaseRight: "Right point on popping crease",
};
