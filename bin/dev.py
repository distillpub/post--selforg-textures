'''Advanced web-development server'''

from __future__ import print_function

import os, glob
import six
if six.PY3:
    from http.server import SimpleHTTPRequestHandler, test
else:
    from SimpleHTTPServer import SimpleHTTPRequestHandler, test

def write_file(fname, fout):
    for s in open(fname):
        if "___MODELS___" in s:
            fout.write(s.replace("___MODELS___", str(glob.glob("*.json"))))
            continue
        if s.startswith('%% '):
            fn = '../'+s.split()[1]
            write_file(fn, fout)
        else:
            fout.write(s)

def build():
    os.system('ls')
    os.system('''curl -o ../article.html \
     --header 'Authorization: token fa067dbcf4cab3902791f99ebdc5a161b3dcccdc' \
     --header 'Accept: application/vnd.github.v3.raw' \
     --location https://api.github.com/repos/znah/post--selforg-textures/contents/article.html \
    ''')
    with open('index.html', 'w') as fout:
      write_file('../main.html', fout)
    with open('demo.js', 'w') as fout:
      write_file('../demo.js', fout)
    print('build finished')


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in ['/', '/index.html']:
            build()
        if six.PY3:
            super().do_GET()
        else:
            SimpleHTTPRequestHandler.do_GET(self)

if __name__ == '__main__':
    os.chdir('public')
    build()
    test(HandlerClass=Handler)
