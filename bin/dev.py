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
    if os.environ.get("GIT_API_KEY_SELFORG") is not None:
        print("using api key in environment")
        os.system('''curl -o ../article.html \
        --header 'Authorization: token ''' + os.environ.get("GIT_API_KEY_SELFORG") + '''' \
        --header 'Accept: application/vnd.github.v3.raw' \
        --location https://api.github.com/repos/$(git remote -v | head -n 1 | sed 's/.*github\.com:\(.*\)\.git.*/\\1/')/contents/article.html \
        ''')
    else:
        print("no api key available")
    with open('index.html', 'w') as fout:
      write_file('../main.html', fout)
    print('build finished')


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in ['/', '/index.html']:
            build()
        if six.PY3:
            super().do_GET()
        else:
            print(self)
            SimpleHTTPRequestHandler.do_GET(self)

if __name__ == '__main__':
    os.chdir('public')
    build()
    test(HandlerClass=Handler)
