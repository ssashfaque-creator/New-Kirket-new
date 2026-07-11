export const BAT_LENGTH_INCHES = 33.5;
export const STUMP_HEIGHT_INCHES = 28;
export const WICKET_WIDTH_INCHES = 9;
export const POPPING_CREASE_DISTANCE_INCHES = 48;

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
  creaseLeft: "Left point on popping crease",
  creaseRight: "Right point on popping crease",
};
