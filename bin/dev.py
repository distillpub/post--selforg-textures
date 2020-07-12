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
            inc = s.split()
            if len(inc) == 4:
                # auto update this file from specified git repo
                update_git_file(*inc[1:])
            fn = '../'+inc[1]
            write_file(fn, fout)
        else:
            fout.write(s)

def update_git_file(path, gitUsername, gitRepo):
    print(path, gitRepo, gitUsername)
    if os.environ.get("GIT_API_KEY_SELFORG") is not None:
        print("using api key in environment")
        print('''curl -o ../''' + path + ''' \
        --header 'Authorization: token ''' + os.environ.get("GIT_API_KEY_SELFORG") + '''' \
        --header 'Accept: application/vnd.github.v3.raw' \
        --location https://api.github.com/repos/''' + gitUsername + '''/''' + gitRepo + '''/contents/''' + path + ''' \
        ''')
        os.system('''curl -o ../''' + path + ''' \
        --header 'Authorization: token ''' + os.environ.get("GIT_API_KEY_SELFORG") + '''' \
        --header 'Accept: application/vnd.github.v3.raw' \
        --location https://api.github.com/repos/''' + gitUsername + '''/''' + gitRepo + '''/contents/''' + path + ''' \
        ''')
    else:
        print("no api key available to auto-download file %s. please provide it by setting ENV var GIT_API_KEY_SELFORG=token" % path)

def build():
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
