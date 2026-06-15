"""
VidTube – YouTube Clone Backend
Flask server with file-I/O storage, secure auth, image compression, video streaming.
"""

from flask import (Flask, render_template, request, redirect, url_for,
                   session, jsonify, send_from_directory, abort, Response, g)
from functools import wraps
import json, os, uuid, hashlib, secrets, time, re, mimetypes
from PIL import Image
import io, threading

app = Flask(__name__)

# ── Persistent secret key (survives restarts so sessions stay valid) ───
BASE    = os.path.dirname(os.path.abspath(__file__))
DATA    = os.path.join(BASE, 'data')
UPLOADS = os.path.join(BASE, 'uploads')
VID_DIR = os.path.join(UPLOADS, 'videos')
THM_DIR = os.path.join(UPLOADS, 'thumbnails')
AVT_DIR = os.path.join(UPLOADS, 'avatars')
USERS_F = os.path.join(DATA, 'users.json')
VIDS_F  = os.path.join(DATA, 'videos.json')
SECRET_F = os.path.join(DATA, '.secret_key')

for d in [DATA, VID_DIR, THM_DIR, AVT_DIR]:
    os.makedirs(d, exist_ok=True)

if os.path.exists(SECRET_F):
    with open(SECRET_F, 'r') as f:
        app.secret_key = f.read().strip()
else:
    app.secret_key = secrets.token_hex(32)
    with open(SECRET_F, 'w') as f:
        f.write(app.secret_key)

app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024

ALLOWED_VID = {'.mp4', '.webm', '.mkv', '.avi', '.mov'}
ALLOWED_IMG = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'}

_file_lock = threading.Lock()

# ── Helpers ────────────────────────────────────────────────────────────
def _load(fp):
    if os.path.exists(fp):
        with open(fp, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def _save(fp, data):
    with _file_lock:
        tmp = fp + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, fp)

def _hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), 200_000)
    return salt, h.hex()

def _verify_pw(pw, salt, hashed):
    return _hash_pw(pw, salt)[1] == hashed

def _compress_img(data, target_kb=1.95):
    """Compress any image to ≈target_kb."""
    img = Image.open(io.BytesIO(data)).convert('RGB')
    mx = 320
    if max(img.size) > mx:
        r = mx / max(img.size)
        img = img.resize((int(img.size[0]*r), int(img.size[1]*r)), Image.LANCZOS)
    target = int(target_kb * 1024)
    for q in range(80, 0, -5):
        buf = io.BytesIO()
        img.save(buf, 'JPEG', quality=q, optimize=True)
        if buf.tell() <= target:
            return buf.getvalue()
    while max(img.size) > 16:
        img = img.resize((int(img.size[0]*0.7), int(img.size[1]*0.7)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, 'JPEG', quality=5, optimize=True)
        if buf.tell() <= target:
            return buf.getvalue()
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=5, optimize=True)
    return buf.getvalue()

def _time_ago(ts):
    d = time.time() - ts
    if d < 60:       return 'just now'
    if d < 3600:     return f'{int(d//60)} min ago'
    if d < 86400:    return f'{int(d//3600)} hours ago'
    if d < 2592000:  return f'{int(d//86400)} days ago'
    if d < 31536000: return f'{int(d//2592000)} months ago'
    return f'{int(d//31536000)} years ago'

def _fmt_views(n):
    if n >= 1_000_000: return f'{n/1_000_000:.1f}M'
    if n >= 1_000:     return f'{n/1_000:.1f}K'
    return str(n)

app.jinja_env.globals.update(time_ago=_time_ago, fmt_views=_fmt_views)

def _enrich(videos, users):
    """Attach channel info to a list of video dicts."""
    for v in videos:
        o = users.get(v.get('user_id', ''), {})
        v['channel_name']   = o.get('channel_name', 'Unknown')
        v['channel_avatar'] = o.get('avatar')
        v['owner_username'] = o.get('username', '')
    return videos

# ── Per-request user (cached in g) ────────────────────────────────────
@app.before_request
def _load_user():
    uid = session.get('user_id')
    if uid:
        users = _load(USERS_F)
        g.user = users.get(uid)
        # Build subscription name map for sidebar
        if g.user:
            subs = []
            for sid in g.user.get('subscriptions', [])[:10]:
                su = users.get(sid, {})
                subs.append({'id': sid, 'name': su.get('channel_name', '?'),
                             'username': su.get('username', ''),
                             'avatar': su.get('avatar')})
            g.sub_list = subs
        else:
            g.sub_list = []
    else:
        g.user = None
        g.sub_list = []

def _u():
    return g.get('user')

def login_required(f):
    @wraps(f)
    def wrap(*a, **kw):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return f(*a, **kw)
    return wrap

# ── Auth ───────────────────────────────────────────────────────────────
@app.route('/signup', methods=['GET','POST'])
def signup():
    if request.method == 'POST':
        uname = request.form.get('username','').strip().lower()
        email = request.form.get('email','').strip().lower()
        pw    = request.form.get('password','')
        cname = request.form.get('channel_name','').strip() or uname
        if not uname or not email or not pw:
            return render_template('signup.html', error='All fields required', user=None)
        if len(pw) < 6:
            return render_template('signup.html', error='Password must be 6+ chars', user=None)
        if not re.match(r'^[a-z0-9_]{3,20}$', uname):
            return render_template('signup.html', error='Username: 3-20 chars, a-z 0-9 _ only', user=None)
        users = _load(USERS_F)
        for u in users.values():
            if u['username'] == uname:
                return render_template('signup.html', error='Username taken', user=None)
            if u['email'] == email:
                return render_template('signup.html', error='Email in use', user=None)
        uid = str(uuid.uuid4())
        salt, hashed = _hash_pw(pw)
        avatar_file = None
        av = request.files.get('avatar')
        if av and av.filename:
            ext = os.path.splitext(av.filename)[1].lower()
            if ext in ALLOWED_IMG:
                compressed = _compress_img(av.read())
                avatar_file = f'{uid}.jpg'
                with open(os.path.join(AVT_DIR, avatar_file), 'wb') as f:
                    f.write(compressed)
        users[uid] = {
            'id': uid, 'username': uname, 'email': email,
            'password_hash': hashed, 'password_salt': salt,
            'channel_name': cname, 'avatar': avatar_file,
            'subscribers': [], 'subscriptions': [],
            'created_at': time.time()
        }
        _save(USERS_F, users)
        session['user_id'] = uid
        return redirect(url_for('index'))
    return render_template('signup.html', user=None)

@app.route('/login', methods=['GET','POST'])
def login():
    if request.method == 'POST':
        uname = request.form.get('username','').strip().lower()
        pw    = request.form.get('password','')
        users = _load(USERS_F)
        for uid, u in users.items():
            if u['username'] == uname and _verify_pw(pw, u['password_salt'], u['password_hash']):
                session['user_id'] = uid
                return redirect(url_for('index'))
        return render_template('login.html', error='Invalid credentials', user=None)
    return render_template('login.html', user=None)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

# ── Pages ──────────────────────────────────────────────────────────────
@app.route('/')
def index():
    vids  = _load(VIDS_F)
    users = _load(USERS_F)
    vlist = sorted(vids.values(), key=lambda v: v.get('uploaded_at',0), reverse=True)
    _enrich(vlist, users)
    return render_template('index.html', videos=vlist, user=_u())

@app.route('/trending')
def trending():
    vids  = _load(VIDS_F)
    users = _load(USERS_F)
    vlist = sorted(vids.values(), key=lambda v: v.get('views',0), reverse=True)
    _enrich(vlist, users)
    return render_template('index.html', videos=vlist, user=_u(), page_title='Trending')

@app.route('/subscriptions')
@login_required
def subscriptions():
    user  = _u()
    vids  = _load(VIDS_F)
    users = _load(USERS_F)
    subs  = set(user.get('subscriptions', []))
    vlist = [v for v in vids.values() if v.get('user_id') in subs]
    vlist.sort(key=lambda v: v.get('uploaded_at',0), reverse=True)
    _enrich(vlist, users)
    return render_template('index.html', videos=vlist, user=user, page_title='Subscriptions')

@app.route('/search')
def search():
    q = request.args.get('q','').strip().lower()
    if not q:
        return redirect(url_for('index'))
    vids  = _load(VIDS_F)
    users = _load(USERS_F)
    results = []
    for v in vids.values():
        haystack = f"{v.get('title','')} {v.get('description','')} {' '.join(v.get('tags',[]))}".lower()
        if q in haystack:
            results.append(v)
    results.sort(key=lambda v: v.get('views',0), reverse=True)
    _enrich(results, users)
    return render_template('index.html', videos=results, user=_u(),
                           page_title=f'Results for "{request.args.get("q","")}"')

@app.route('/upload', methods=['GET','POST'])
@login_required
def upload():
    user = _u()
    if request.method == 'POST':
        title = request.form.get('title','').strip()
        desc  = request.form.get('description','').strip()
        tags  = [t.strip() for t in request.form.get('tags','').split(',') if t.strip()]
        cat   = request.form.get('category','Entertainment')
        vf    = request.files.get('video')
        tf    = request.files.get('thumbnail')
        if not vf or not title:
            return render_template('upload.html', user=user, error='Title and video required')
        vext = os.path.splitext(vf.filename)[1].lower()
        if vext not in ALLOWED_VID:
            return render_template('upload.html', user=user, error='Invalid video format')
        vid   = str(uuid.uuid4())
        vname = f'{vid}{vext}'
        vf.save(os.path.join(VID_DIR, vname))
        tname = None
        if tf and tf.filename:
            text = os.path.splitext(tf.filename)[1].lower()
            if text in ALLOWED_IMG:
                compressed = _compress_img(tf.read())
                tname = f'{vid}.jpg'
                with open(os.path.join(THM_DIR, tname), 'wb') as f:
                    f.write(compressed)
        vids = _load(VIDS_F)
        vids[vid] = {
            'id': vid, 'title': title, 'description': desc,
            'tags': tags, 'category': cat,
            'video_file': vname, 'thumbnail': tname,
            'user_id': session['user_id'],
            'views': 0, 'likes': [], 'dislikes': [],
            'comments': [], 'uploaded_at': time.time()
        }
        _save(VIDS_F, vids)
        return redirect(url_for('watch', video_id=vid))
    return render_template('upload.html', user=user)

@app.route('/watch/<video_id>')
def watch(video_id):
    vids = _load(VIDS_F)
    v = vids.get(video_id)
    if not v:
        abort(404)
    v['views'] = v.get('views', 0) + 1
    vids[video_id] = v
    _save(VIDS_F, vids)

    users = _load(USERS_F)
    owner = users.get(v.get('user_id',''), {})
    v['channel_name']     = owner.get('channel_name','Unknown')
    v['channel_avatar']   = owner.get('avatar')
    v['owner_username']   = owner.get('username','')
    v['subscriber_count'] = len(owner.get('subscribers',[]))

    cur = _u()
    is_subscribed = cur and v.get('user_id') in cur.get('subscriptions',[])

    for c in v.get('comments',[]):
        cu = users.get(c.get('user_id',''), {})
        c['username']     = cu.get('username','deleted')
        c['avatar']       = cu.get('avatar')
        c['channel_name'] = cu.get('channel_name','Deleted')

    related = [rv for rv in vids.values() if rv['id'] != video_id]
    related.sort(key=lambda x: x.get('views',0), reverse=True)
    _enrich(related[:12], users)

    return render_template('watch.html', video=v, user=cur,
                           is_subscribed=is_subscribed, related=related[:12])

@app.route('/channel/<username>')
def channel(username):
    users = _load(USERS_F)
    owner = next((u for u in users.values() if u['username'] == username), None)
    if not owner:
        abort(404)
    vids = _load(VIDS_F)
    ch_vids = sorted(
        [v for v in vids.values() if v.get('user_id') == owner['id']],
        key=lambda v: v.get('uploaded_at',0), reverse=True
    )
    _enrich(ch_vids, users)
    cur = _u()
    is_subscribed = cur and owner['id'] in cur.get('subscriptions',[])
    return render_template('channel.html', owner=owner, videos=ch_vids,
                           user=cur, is_subscribed=is_subscribed)

# ── APIs ───────────────────────────────────────────────────────────────
@app.route('/api/like', methods=['POST'])
@login_required
def api_like():
    vid = request.get_json().get('video_id')
    vids = _load(VIDS_F)
    v = vids.get(vid)
    if not v: return jsonify(error='Not found'), 404
    uid = session['user_id']
    if uid in v.get('dislikes',[]): v['dislikes'].remove(uid)
    if uid in v.get('likes',[]): v['likes'].remove(uid)
    else: v['likes'].append(uid)
    vids[vid] = v; _save(VIDS_F, vids)
    return jsonify(likes=len(v['likes']), dislikes=len(v['dislikes']),
                   liked=uid in v['likes'], disliked=uid in v['dislikes'])

@app.route('/api/dislike', methods=['POST'])
@login_required
def api_dislike():
    vid = request.get_json().get('video_id')
    vids = _load(VIDS_F)
    v = vids.get(vid)
    if not v: return jsonify(error='Not found'), 404
    uid = session['user_id']
    if uid in v.get('likes',[]): v['likes'].remove(uid)
    if uid in v.get('dislikes',[]): v['dislikes'].remove(uid)
    else: v['dislikes'].append(uid)
    vids[vid] = v; _save(VIDS_F, vids)
    return jsonify(likes=len(v['likes']), dislikes=len(v['dislikes']),
                   liked=uid in v['likes'], disliked=uid in v['dislikes'])

@app.route('/api/subscribe', methods=['POST'])
@login_required
def api_subscribe():
    target = request.get_json().get('user_id')
    users = _load(USERS_F)
    cur_id = session['user_id']
    if target not in users or target == cur_id:
        return jsonify(error='Invalid'), 400
    cur, tgt = users[cur_id], users[target]
    if target in cur.get('subscriptions',[]):
        cur['subscriptions'].remove(target)
        if cur_id in tgt.get('subscribers',[]): tgt['subscribers'].remove(cur_id)
        subscribed = False
    else:
        cur.setdefault('subscriptions',[]).append(target)
        tgt.setdefault('subscribers',[]).append(cur_id)
        subscribed = True
    users[cur_id] = cur; users[target] = tgt
    _save(USERS_F, users)
    return jsonify(subscribed=subscribed, count=len(tgt['subscribers']))

@app.route('/api/comment', methods=['POST'])
@login_required
def api_comment():
    d = request.get_json()
    vid, text = d.get('video_id'), d.get('text','').strip()
    if not text: return jsonify(error='Empty'), 400
    vids = _load(VIDS_F)
    v = vids.get(vid)
    if not v: return jsonify(error='Not found'), 404
    users = _load(USERS_F)
    cu = users.get(session['user_id'], {})
    comment = {
        'id': str(uuid.uuid4()), 'user_id': session['user_id'],
        'text': text, 'created_at': time.time(),
        'username': cu.get('username',''), 'avatar': cu.get('avatar'),
        'channel_name': cu.get('channel_name','')
    }
    v.setdefault('comments',[]).insert(0, comment)
    vids[vid] = v; _save(VIDS_F, vids)
    return jsonify(comment=comment, time_ago=_time_ago(comment['created_at']))

# ── File Serving (with byte-range for video seeking) ───────────────────
@app.route('/api/video/<filename>')
def serve_video(filename):
    safe = os.path.basename(filename)
    path = os.path.join(VID_DIR, safe)
    if not os.path.exists(path): abort(404)
    mime  = mimetypes.guess_type(path)[0] or 'video/mp4'
    fsize = os.path.getsize(path)
    rng   = request.headers.get('Range')
    if rng:
        m = re.match(r'bytes=(\d+)-(\d*)', rng)
        if m:
            start  = int(m.group(1))
            end    = int(m.group(2)) if m.group(2) else min(start + 1048576, fsize - 1)
            end    = min(end, fsize - 1)
            length = end - start + 1
            with open(path, 'rb') as f:
                f.seek(start)
                data = f.read(length)
            resp = Response(data, 206, mimetype=mime)
            resp.headers.update({
                'Content-Range': f'bytes {start}-{end}/{fsize}',
                'Accept-Ranges': 'bytes',
                'Content-Length': str(length),
                'Cache-Control': 'no-cache'
            })
            return resp
    return send_from_directory(VID_DIR, safe, mimetype=mime)

@app.route('/api/thumbnail/<filename>')
def serve_thumb(filename):
    return send_from_directory(THM_DIR, os.path.basename(filename))

@app.route('/api/avatar/<filename>')
def serve_avatar(filename):
    return send_from_directory(AVT_DIR, os.path.basename(filename))

# ── Error pages ────────────────────────────────────────────────────────
@app.errorhandler(404)
def page_not_found(e):
    return render_template('404.html', user=_u()), 404

if __name__ == '__main__':
    app.run(debug=True, port=5000)
