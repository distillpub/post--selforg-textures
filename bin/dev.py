''' "Advanced web-development server" '''

from __future__ import print_function

import os, glob
import six
from six.moves.urllib.request import urlopen, Request
if six.PY3:
    from http.server import SimpleHTTPRequestHandler, test
else:
    from SimpleHTTPServer import SimpleHTTPRequestHandler, test
import re

# https://medium.com/@moreless/how-to-fix-python-ssl-certificate-verify-failed-97772d9dd14c 
import ssl
if (not os.environ.get('PYTHONHTTPSVERIFY', '') and
getattr(ssl, '_create_unverified_context', None)):
    ssl._create_default_https_context = ssl._create_unverified_context

def copy_byte_range(infile, outfile, start=None, stop=None, bufsize=16*1024):
    '''Like shutil.copyfileobj, but only copy a range of the streams.
    Both start and stop are inclusive.
    '''
    if start is not None: infile.seek(start)
    while 1:
        to_read = min(bufsize, stop + 1 - infile.tell() if stop else bufsize)
        buf = infile.read(to_read)
        if not buf:
            break
        outfile.write(buf)


BYTE_RANGE_RE = re.compile(r'bytes=(\d+)-(\d+)?$')
def parse_byte_range(byte_range):
    '''Returns the two numbers in 'bytes=123-456' or throws ValueError.
    The last number or both numbers may be None.
    '''
    if byte_range.strip() == '':
        return None, None

    m = BYTE_RANGE_RE.match(byte_range)
    if not m:
        raise ValueError('Invalid byte range %s' % byte_range)

    first, last = [x and int(x) for x in m.groups()]
    if last and last < first:
        raise ValueError('Invalid byte range %s' % byte_range)
    return first, last

def write_file(fname, fout, article_html):
    for s in open(fname) if (fname != "../article.html" or article_html is None) else article_html:
        if not (isinstance(s, str)):
            s = s.decode('utf-8')
        if "___MODELS___" in s:
            fout.write(s.replace("___MODELS___", str(glob.glob("*.json"))))
            continue
        if s.strip().startswith('{% include '):
            fn = '../'+s.split()[2]
            write_file(fn, fout, article_html)
        else:
            fout.write(s)

def build():
    article_html = None
    try:
        found_remote = False
        remote_url = None
        for s in open('../.git/config'):
            if s.strip() == '[remote "origin"]':
                found_remote = True
            if found_remote and s.strip().startswith('url'):
                remote_url = s.strip().split('=', 1)[1]
        uname_and_repo = re.match(r".*github\.com[:|/](.*)\.git.*", remote_url).group(1)
        req = Request('https://api.github.com/repos/' + uname_and_repo + '/contents/article.html')
        req.add_header('Authorization', 'token ' + os.environ.get("GIT_API_KEY_SELFORG"))
        req.add_header('Accept', 'application/vnd.github.v3.raw')
        article_html = urlopen(req)
        if article_html.getcode() != 200:
          print('github response was not 200')
          article_html = None
    except Exception as e:
        article_html = None
        print("failed to fetch latest article.html. error:");
        print(e)
    with open('index.html', 'w') as fout:
      write_file('../main.html', fout, article_html)
    print('build finished')


class Handler(SimpleHTTPRequestHandler):

    def do_GET(self):
        if self.path in ['/', '/index.html']:
            build()
        if six.PY3:
            super().do_GET()
        else:
            SimpleHTTPRequestHandler.do_GET(self)

    # From https://github.com/danvk/RangeHTTPServer.
    # Safari requires Range to be supported for video files.
    def send_head(self):
        if 'Range' not in self.headers:
            self.range = None
            return SimpleHTTPRequestHandler.send_head(self)
        try:
            self.range = parse_byte_range(self.headers['Range'])
        except ValueError as e:
            self.send_error(400, 'Invalid byte range')
            return None
        first, last = self.range

        # Mirroring SimpleHTTPServer.py here
        path = self.translate_path(self.path)
        f = None
        ctype = self.guess_type(path)
        try:
            f = open(path, 'rb')
        except IOError:
            self.send_error(404, 'File not found')
            return None

        fs = os.fstat(f.fileno())
        file_len = fs[6]
        if first >= file_len:
            self.send_error(416, 'Requested Range Not Satisfiable')
            return None

        self.send_response(206)
        self.send_header('Content-type', ctype)
        self.send_header('Accept-Ranges', 'bytes')

        if last is None or last >= file_len:
            last = file_len - 1
        response_length = last - first + 1

        self.send_header('Content-Range',
                         'bytes %s-%s/%s' % (first, last, file_len))
        self.send_header('Content-Length', str(response_length))
        self.send_header('Last-Modified', self.date_time_string(fs.st_mtime))
        self.end_headers()
        return f

    def copyfile(self, source, outputfile):
        if not self.range:
            return SimpleHTTPRequestHandler.copyfile(self, source, outputfile)

        # SimpleHTTPRequestHandler uses shutil.copyfileobj, which doesn't let
        # you stop the copying before the end of the file.
        start, stop = self.range  # set in send_head()
        copy_byte_range(source, outputfile, start, stop)
    

if __name__ == '__main__':
    os.chdir('public')
    build()
    test(HandlerClass=Handler)
