// TerrainData.js — v0.2.0
// Terrain is defined as a polyline of [x, y] points in the 800×450 space,
// originally ported from tblazevic and then widened in a few spots so the
// scaled-up lander has more forgiving landing areas. Origin is top-left in
// the source data; Main.js shifts it to centered coordinates when building
// meshes. Flat segments (two consecutive points sharing y) become landing
// pads; LanderMode tags beginner pads via their center-x.

export const points = [
  // Left bay: widened the [20,12]→[40,12] pad to [15,12]→[45,12] (30 wide)
  [0,28],   [10,15],  [15,12],  [45,12],  [50,24],  [60,50],  [65,70],  [80,70],
  [85,100], [90,110], [100,150],[110,140],[120,135],[135,135],[140,100],[150,105],
  // Middle mesa: new wide [170,100]→[200,100] beginner pad (30 wide).
  // Second pad kept at 15 wide by shifting its endpoints in step.
  [160,108],[170,100],[200,100],[210,60], [215,30], [220,25], [235,25], [240,30],
  [250,75], [260,80], [270,100],[280,120],[300,120],[310,160],[320,180],[340,180],
  [350,212],[360,215],[370,217],[380,215],[390,200],[400,140],[405,110],[410,140],
  [425,140],[430,70], [440,10], [460,10], [465,15], [470,20], [480,40], [495,40],
  // Right-central plateau: new wide [510,80]→[540,80] beginner pad (30 wide)
  [500,65], [510,80], [540,80], [550,72], [552,72], [560,70], [580,70], [590,45],
  [600,20], [610,18], [620,20], [640,20], [650,80], [660,92], [670,95], [690,95],
  [695,100],[700,140],[715,140],[720,130],[730,100],[740,105],[760,105],[770,108],
  [780,110],[790,115],[800,117]
];
