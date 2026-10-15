"""Bundles src/page.html + src/assets.js + src/level.js + src/game.js into one playable file: play.html.
Run: python3 tools/build.py"""
import os
root = os.path.join(os.path.dirname(__file__), '..')
read = lambda *p: open(os.path.join(root, *p)).read()
page = read('src', 'page.html').replace('/*ASSETS*/', read('src', 'assets.js')).replace('/*LEVEL*/', read('src', 'level.js')).replace('/*GAME*/', read('src', 'game.js'))
open(os.path.join(root, 'play.html'), 'w').write(page)
print('play.html', len(page) // 1024, 'KB')
