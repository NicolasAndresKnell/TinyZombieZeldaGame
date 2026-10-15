"""Where each prop sits on assets/source/tileset.webp (full-size pixel boxes)."""
from extract import *
S = 1.875
a = load('tileset')
pieces = {
  'tree_s': (470,114,505,190), 'tree_m': (505,114,563,190), 'tree_l': (563,114,630,190),
  'hedge': (168,258,290,376), 'building': (130,9,262,260), 'roof_red': (466,11,568,112),
  'door': (378,142,447,212), 'door2': (284,141,354,212), 'win_tall': (284,3,324,74), 'win_wide': (346,95,446,135),
  'dumpster': (383,256,474,316), 'fence': (476,256,564,318), 'fence2': (566,257,656,316),
  'bench': (470,205,537,254), 'bag': (536,226,564,254), 'bag2': (566,224,596,254),
  'barrel': (384,314,408,350), 'tire': (412,318,442,348), 'crate': (472,316,536,350), 'box': (347,253,383,289),
}
