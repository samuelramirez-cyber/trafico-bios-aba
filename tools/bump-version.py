"""Sube el número de versión de los módulos JS (import map de index.html) para que el navegador
nunca mezcle archivos viejos y nuevos tras publicar. Uso:  python tools/bump-version.py"""
import pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
modules = ['app.js', 'config.js', *sorted(f'js/{p.name}' for p in (root / 'js').glob('*.js'))]
html = (root / 'index.html').read_text(encoding='utf-8')
m = re.search(r'\?v=(\d+)', html)
v = int(m.group(1)) + 1 if m else 1
entries = ',\n'.join(f'      "./{p}": "./{p}?v={v}"' for p in modules)
block = f'<script type="importmap">\n  {{\n    "imports": {{\n{entries}\n    }}\n  }}\n  </script>'
html = re.sub(r'<script type="importmap">.*?</script>', block, html, flags=re.S) if 'importmap' in html \
    else html.replace('<script type="module" src="app.js"></script>', f'{block}\n  <script type="module" src="app.js"></script>')
html = re.sub(r'<script type="module" src="app\.js(\?v=\d+)?"></script>', f'<script type="module" src="app.js?v={v}"></script>', html)
(root / 'index.html').write_text(html, encoding='utf-8', newline='\n')
sw = root / 'sw.js'
sw.write_text(re.sub(r"const VERSION = 'trafico-v\d+';", f"const VERSION = 'trafico-v{v + 5}';", sw.read_text(encoding='utf-8')), encoding='utf-8', newline='\n')
print('versión', v)
